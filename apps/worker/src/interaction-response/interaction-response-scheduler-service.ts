import {
  InteractionResponsesRepository,
  OutboxRepository,
  TransactionManager,
} from '@content-platform/database';

export interface InteractionResponseSchedulerServiceDeps {
  txManager: TransactionManager;
  responsesRepo: InteractionResponsesRepository;
  outboxRepo: OutboxRepository;
  /** Maximum responses to claim per scan. */
  batchSize: number;
  /**
   * A response is "stale" when its `updated_at` is older than this
   * many seconds and it is in one of the unresolved statuses
   * (`IN_PROGRESS`, `UNKNOWN`). Stale rows are enqueued for pull
   * reconciliation.
   */
  staleThresholdSeconds: number;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface InteractionResponseSchedulerRunResult {
  scheduledCount: number;
  reconciledCount: number;
}

/**
 * Interaction response scheduler.
 *
 * Two independent scans:
 *
 *   1. SCHEDULED responses with scheduled_at <= now()
 *      - Atomic transition: SCHEDULED → QUEUED
 *      - Outbox enqueue: webhook.respond:{responseId}
 *
 *   2. Unresolved responses older than staleThresholdSeconds
 *      - Unresolved statuses: IN_PROGRESS, UNKNOWN
 *      - Atomic touch: updated_at = now() (status unchanged)
 *      - Outbox enqueue: webhook.respond.reconcile:{responseId}:{ts}
 *
 * The IN_PROGRESS case covers a worker that started but never reported
 * back (crash, SIGKILL, hung HTTP call). The UNKNOWN case covers a
 * worker that reported a network or unknown error and gave up without
 * scheduling its own reconciliation. Both need the same follow-up: a
 * pull reconciliation against the provider.
 *
 * Both scans claim rows with FOR UPDATE SKIP LOCKED and perform the
 * state change and the outbox enqueue inside a single transaction.
 */
export class InteractionResponseSchedulerService {
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(private readonly deps: InteractionResponseSchedulerServiceDeps) {
    this.log = deps.logger ?? console;
  }

  async runOnce(): Promise<InteractionResponseSchedulerRunResult> {
    const scheduledCount = await this.scanScheduled();
    const reconciledCount = await this.scanStaleUnresolved();
    return { scheduledCount, reconciledCount };
  }

  private async scanScheduled(): Promise<number> {
    const { txManager, responsesRepo, outboxRepo, batchSize } = this.deps;

    return await txManager.run(async (tx) => {
      const ids = await responsesRepo.claimDueScheduled(tx, batchSize);

      for (const id of ids) {
        await outboxRepo.enqueue(tx, {
          queueName: 'webhook.respond',
          jobId: `webhook.respond:${id}`,
          payload: { responseId: id },
        });
      }

      return ids.length;
    });
  }

  private async scanStaleUnresolved(): Promise<number> {
    const { txManager, responsesRepo, outboxRepo, batchSize, staleThresholdSeconds } = this.deps;

    return await txManager.run(async (tx) => {
      const ids = await responsesRepo.touchStaleUnresolved(tx, staleThresholdSeconds, batchSize);

      const ts = Date.now();
      for (const id of ids) {
        await outboxRepo.enqueue(tx, {
          queueName: 'webhook.respond.reconcile',
          jobId: `webhook.respond.reconcile:${id}:${ts}`,
          payload: { responseId: id },
        });
      }

      return ids.length;
    });
  }
}
