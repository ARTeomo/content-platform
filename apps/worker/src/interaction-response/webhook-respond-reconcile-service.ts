import type {
  ExternalInteractionsRepository,
  InteractionResponsesRepository,
  InteractionResponseReconciliationsRepository,
  OutboxRepository,
  TransactionManager,
} from '@content-platform/database';
import type { MetaResponseReconciler } from '@content-platform/publishers';

export interface WebhookRespondReconcileServiceDeps {
  txManager: TransactionManager;
  responsesRepo: InteractionResponsesRepository;
  reconciliationsRepo: InteractionResponseReconciliationsRepository;
  interactionsRepo: ExternalInteractionsRepository;
  outboxRepo: OutboxRepository;
  reconciler: MetaResponseReconciler;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export type ReconcileOutcome =
  | { kind: 'SKIPPED'; reason: string }
  | { kind: 'RESPONDED'; externalResponseId: string }
  | { kind: 'RETRY_ENQUEUED' }
  | { kind: 'STILL_UNKNOWN'; reason: string };

/**
 * Reconcile path for outbound responses whose external outcome is
 * uncertain (UNKNOWN or stale IN_PROGRESS).
 *
 * Uses pull reconciliation via the parent comment's replies. Push
 * reconciliation (the platform's own reply reappearing as a feed
 * webhook) is handled separately by the `webhook.process` service.
 *
 * Never throws for expected business errors. Only unexpected I/O
 * failures escape so BullMQ can retry the job.
 */
export class WebhookRespondReconcileService {
  private readonly deps: WebhookRespondReconcileServiceDeps;
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(deps: WebhookRespondReconcileServiceDeps) {
    this.deps = deps;
    this.log = deps.logger ?? console;
  }

  async reconcile(responseId: string): Promise<ReconcileOutcome> {
    const {
      txManager,
      responsesRepo,
      reconciliationsRepo,
      interactionsRepo,
      outboxRepo,
      reconciler,
    } = this.deps;

    // 1. Load the response.
    const response = await responsesRepo.findById(responseId);
    if (!response) {
      return { kind: 'SKIPPED', reason: 'response not found' };
    }

    // 2. Only UNKNOWN or (stale) IN_PROGRESS responses are eligible.
    if (response.status !== 'UNKNOWN' && response.status !== 'IN_PROGRESS') {
      return {
        kind: 'SKIPPED',
        reason: `status is ${response.status}, not reconcile-eligible`,
      };
    }

    // 3. Body must be present.
    const body = response.body;
    if (body === null || body.length === 0) {
      return { kind: 'SKIPPED', reason: 'response has no body' };
    }

    // 4. Load the interaction to get the parent comment id.
    const interaction = await interactionsRepo.findById(response.interactionId);
    if (!interaction) {
      return {
        kind: 'SKIPPED',
        reason: `interaction ${response.interactionId} not found`,
      };
    }

    // 5. Pull reconciliation.
    const result = await reconciler.pull({
      destinationId: response.destinationId,
      parentCommentId: interaction.externalInteractionId,
      expectedBody: body,
    });

    const now = new Date();

    switch (result.status) {
      case 'RESPONDED': {
        await txManager.run(async (tx) => {
          await responsesRepo.markResponded(tx, responseId, result.externalResponseId, now);
          await reconciliationsRepo.record(tx, {
            responseId,
            status: 'RESPONDED',
            checkedAt: now,
            externalResponseId: result.externalResponseId,
          });
        });
        this.log.info(
          `[webhook.respond.reconcile] response ${responseId} resolved RESPONDED (${result.externalResponseId})`,
        );
        return { kind: 'RESPONDED', externalResponseId: result.externalResponseId };
      }

      case 'RETRY_ELIGIBLE': {
        // Move to RETRY and enqueue a fresh webhook.respond job. The job
        // id suffix uses the reconciliation count, which is monotonic
        // and deterministic given the DB state, so re-running this
        // reconcile cannot double-enqueue the same logical retry.
        const reconcileCount = await reconciliationsRepo.countForResponse(responseId);
        const jobId = `webhook.respond:${responseId}:reconcile:${reconcileCount}`;

        await txManager.run(async (tx) => {
          await responsesRepo.markRetry(tx, responseId);
          await reconciliationsRepo.record(tx, {
            responseId,
            status: 'RETRY_ELIGIBLE',
            checkedAt: now,
          });
          await outboxRepo.enqueue(tx, {
            queueName: 'webhook.respond',
            jobId,
            payload: { responseId },
          });
        });
        this.log.info(
          `[webhook.respond.reconcile] response ${responseId} retry-eligible, enqueued ${jobId}`,
        );
        return { kind: 'RETRY_ENQUEUED' };
      }

      case 'UNKNOWN': {
        await txManager.run(async (tx) => {
          await reconciliationsRepo.record(tx, {
            responseId,
            status: 'UNKNOWN',
            checkedAt: now,
            details: { reason: result.reason },
          });
        });
        this.log.warn(
          `[webhook.respond.reconcile] response ${responseId} still unknown: ${result.reason}`,
        );
        return { kind: 'STILL_UNKNOWN', reason: result.reason };
      }
    }
  }
}
