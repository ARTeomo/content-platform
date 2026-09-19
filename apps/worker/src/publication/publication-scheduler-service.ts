import {
  OutboxRepository,
  PublicationsRepository,
  TransactionManager,
} from '@content-platform/database';

export interface PublicationSchedulerServiceDeps {
  txManager: TransactionManager;
  publicationsRepo: PublicationsRepository;
  outboxRepo: OutboxRepository;
  /** Maximum number of publications to claim per scan. */
  batchSize: number;
  /**
   * A RECONCILIATION publication is considered stale when its updated_at
   * is older than this many seconds.
   */
  reconcileStaleThresholdSeconds: number;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface PublicationSchedulerRunResult {
  scheduledCount: number;
  reconciledCount: number;
}

/**
 * Publication scheduler.
 *
 * Two independent scans:
 *
 *   1. SCHEDULED publications with scheduled_at <= now()
 *      - Atomic transition: SCHEDULED → RESERVED
 *      - Outbox enqueue: content.publish:{publicationId}
 *
 *   2. RECONCILIATION publications with updated_at older than the
 *      configured threshold
 *      - Atomic touch: updated_at = now() (status unchanged)
 *      - Outbox enqueue: publication.reconcile:{publicationId}:{ts}
 *
 * Both scans claim rows with FOR UPDATE SKIP LOCKED and perform the
 * state change and the outbox enqueue inside a single transaction. A
 * concurrent scheduler instance cannot claim the same row, and the
 * outbox job_id uniqueness protects against accidental double enqueue.
 */
export class PublicationSchedulerService {
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(private readonly deps: PublicationSchedulerServiceDeps) {
    this.log = deps.logger ?? console;
  }

  async runOnce(): Promise<PublicationSchedulerRunResult> {
    const scheduledCount = await this.scanScheduled();
    const reconciledCount = await this.scanStaleReconciliation();
    return { scheduledCount, reconciledCount };
  }

  private async scanScheduled(): Promise<number> {
    const { txManager, publicationsRepo, outboxRepo, batchSize } = this.deps;

    return await txManager.run(async (tx) => {
      const ids = await publicationsRepo.claimDueScheduled(tx, batchSize);

      for (const id of ids) {
        await outboxRepo.enqueue(tx, {
          queueName: 'content.publish',
          jobId: `content.publish:${id}`,
          payload: { publicationId: id },
        });
      }

      return ids.length;
    });
  }

  private async scanStaleReconciliation(): Promise<number> {
    const { txManager, publicationsRepo, outboxRepo, batchSize, reconcileStaleThresholdSeconds } =
      this.deps;

    return await txManager.run(async (tx) => {
      const ids = await publicationsRepo.touchStaleReconciliation(
        tx,
        reconcileStaleThresholdSeconds,
        batchSize,
      );

      const ts = Date.now();
      for (const id of ids) {
        await outboxRepo.enqueue(tx, {
          queueName: 'publication.reconcile',
          jobId: `publication.reconcile:${id}:${ts}`,
          payload: { publicationId: id },
        });
      }

      return ids.length;
    });
  }
}
