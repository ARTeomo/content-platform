import {
  OutboxRepository,
  PublicationsRepository,
  InteractionResponsesRepository,
  TransactionManager,
  sql,
  type Database,
} from '@content-platform/database';

export interface SystemRebuildJobData {
  scope?: 'webhook_events' | 'publications' | 'interaction_responses' | 'all';
  staleThresholdSeconds?: number;
  limit?: number;
}

export interface SystemRebuildOutcome {
  webhookEventsReenqueued: number;
  publicationsReenqueued: number;
  interactionResponsesReenqueued: number;
}

export interface SystemRebuildServiceDeps {
  db: Database;
  txManager: TransactionManager;
  outboxRepo: OutboxRepository;
  publicationsRepo: PublicationsRepository;
  interactionResponsesRepo: InteractionResponsesRepository;
  defaultStaleThresholdSeconds: number;
  defaultLimit: number;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

/**
 * Rebuilds the queue layer from durable PostgreSQL state.
 *
 * This is a safety net for the case where BullMQ state is lost
 * (Redis wipe, queue corruption) while the durable state machine
 * still reflects work that should be in flight.
 *
 * The service does NOT reset entity statuses. It re-enqueues jobs for
 * entities whose durable state says a job should exist. Idempotency
 * comes from two layers:
 *
 *   1. The job_id carries a `:rebuild:<epoch_ms>` suffix, so a rebuild
 *      never collides with the primary scheduler's job_ids.
 *   2. The outbox `enqueue` is idempotent on job_id.
 *
 * Downstream workers use their own atomic claim guards
 * (`claimForProcessing`, `claimForPublishing`, `claimForResponding`),
 * so a duplicate rebuild cannot produce duplicate external side
 * effects.
 *
 * The service deliberately does NOT touch entities stuck in
 * `RESERVED`, `IN_PROGRESS`, or `RECONCILIATION`. Those need the
 * reconciliation flows, not a blind reset.
 */
export class SystemRebuildService {
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(private readonly deps: SystemRebuildServiceDeps) {
    this.log = deps.logger ?? console;
  }

  async rebuild(job: SystemRebuildJobData): Promise<SystemRebuildOutcome> {
    const scope = job.scope ?? 'all';
    const threshold = job.staleThresholdSeconds ?? this.deps.defaultStaleThresholdSeconds;
    const limit = job.limit ?? this.deps.defaultLimit;

    const result: SystemRebuildOutcome = {
      webhookEventsReenqueued: 0,
      publicationsReenqueued: 0,
      interactionResponsesReenqueued: 0,
    };

    if (scope === 'all' || scope === 'webhook_events') {
      result.webhookEventsReenqueued = await this.rebuildWebhookEvents(threshold, limit);
    }
    if (scope === 'all' || scope === 'publications') {
      result.publicationsReenqueued = await this.rebuildPublications(limit);
    }
    if (scope === 'all' || scope === 'interaction_responses') {
      result.interactionResponsesReenqueued = await this.rebuildInteractionResponses(limit);
    }

    return result;
  }

  private async rebuildWebhookEvents(threshold: number, limit: number): Promise<number> {
    return await this.deps.txManager.run(async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT id FROM webhook_events
        WHERE status = 'RECEIVED'
          AND received_at < now() - interval '${sql.raw(String(threshold))} seconds'
        ORDER BY received_at ASC
        LIMIT ${limit}
      `)) as unknown as Array<{ id: string }>;

      const ts = Date.now();
      let count = 0;
      for (const row of rows) {
        const inserted = await this.deps.outboxRepo.enqueue(tx, {
          queueName: 'webhook.process',
          jobId: `webhook.process:${row.id}:rebuild:${ts}`,
          payload: { webhookEventId: row.id },
        });
        if (inserted) count++;
      }
      return count;
    });
  }

  private async rebuildPublications(limit: number): Promise<number> {
    return await this.deps.txManager.run(async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT id FROM publications
        WHERE status = 'SCHEDULED'
          AND scheduled_at IS NOT NULL
          AND scheduled_at <= now()
        ORDER BY scheduled_at ASC
        LIMIT ${limit}
      `)) as unknown as Array<{ id: string }>;

      const ts = Date.now();
      let count = 0;
      for (const row of rows) {
        const inserted = await this.deps.outboxRepo.enqueue(tx, {
          queueName: 'content.publish',
          jobId: `content.publish:${row.id}:rebuild:${ts}`,
          payload: { publicationId: row.id },
        });
        if (inserted) count++;
      }
      return count;
    });
  }

  private async rebuildInteractionResponses(limit: number): Promise<number> {
    return await this.deps.txManager.run(async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT id FROM interaction_responses
        WHERE status = 'SCHEDULED'
          AND scheduled_at IS NOT NULL
          AND scheduled_at <= now()
        ORDER BY scheduled_at ASC
        LIMIT ${limit}
      `)) as unknown as Array<{ id: string }>;

      const ts = Date.now();
      let count = 0;
      for (const row of rows) {
        const inserted = await this.deps.outboxRepo.enqueue(tx, {
          queueName: 'webhook.respond',
          jobId: `webhook.respond:${row.id}:rebuild:${ts}`,
          payload: { responseId: row.id },
        });
        if (inserted) count++;
      }
      return count;
    });
  }
}
