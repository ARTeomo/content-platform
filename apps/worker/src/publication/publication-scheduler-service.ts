import {
  OutboxRepository,
  PublicationsRepository,
  TransactionManager,
} from '@content-platform/database';
import type { MetaCredentialService, MetaCredentialStatus } from '@content-platform/authentication';

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
  /**
   * Credential health gate.
   *
   * When present, the scheduler consults `healthCheck(destinationId)`
   * before enqueuing a `content.publish` job. Destinations whose
   * overall credential status is INVALID are skipped; the publication
   * row is moved to FAILED so it does not re-enter the scan window.
   *
   * When absent, no gate is applied (development / test mode).
   */
  credentialService?: MetaCredentialService;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface PublicationSchedulerRunResult {
  scheduledCount: number;
  reconciledCount: number;
  /** Publications skipped because the destination credential was INVALID. */
  blockedByCredentialCount: number;
}

/**
 * Publication scheduler.
 *
 * Two independent scans:
 *
 *   1. SCHEDULED publications with scheduled_at <= now()
 *      - Atomic transition: SCHEDULED → RESERVED
 *      - Credential health gate per destination
 *      - Outbox enqueue: content.publish:{publicationId}
 *
 *   2. RECONCILIATION publications with updated_at older than the
 *      configured threshold
 *      - Atomic touch: updated_at = now() (status unchanged)
 *      - Outbox enqueue: publication.reconcile:{publicationId}:{ts}
 *
 * Both scans claim rows with FOR UPDATE SKIP LOCKED and perform the
 * state change and the outbox enqueue inside a single transaction.
 */
export class PublicationSchedulerService {
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(private readonly deps: PublicationSchedulerServiceDeps) {
    this.log = deps.logger ?? console;
  }

  async runOnce(): Promise<PublicationSchedulerRunResult> {
    const scheduled = await this.scanScheduled();
    const reconciledCount = await this.scanStaleReconciliation();
    return {
      scheduledCount: scheduled.enqueued,
      reconciledCount,
      blockedByCredentialCount: scheduled.blocked,
    };
  }

  private async scanScheduled(): Promise<{ enqueued: number; blocked: number }> {
    const { txManager, publicationsRepo, outboxRepo, batchSize, credentialService } = this.deps;

    return await txManager.run(async (tx) => {
      const ids = await publicationsRepo.claimDueScheduled(tx, batchSize);
      if (ids.length === 0) return { enqueued: 0, blocked: 0 };

      // Batch lookup of destinationId per publication.
      const destinationByPublication = await publicationsRepo.findDestinationIdsByIds(tx, ids);

      // Batch health check per destination (one call per unique destination).
      const healthByDestination = new Map<string, MetaCredentialStatus>();
      if (credentialService) {
        const uniqueDestinations = new Set(destinationByPublication.values());
        for (const destinationId of uniqueDestinations) {
          try {
            const report = await credentialService.healthCheck(destinationId);
            healthByDestination.set(destinationId, report.overall);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.log.error(
              `[publication.schedule] credential health check failed for ${destinationId}: ${msg}`,
            );
            healthByDestination.set(destinationId, 'UNKNOWN');
          }
        }
      }

      let enqueued = 0;
      let blocked = 0;

      for (const id of ids) {
        const destinationId = destinationByPublication.get(id);
        const health = destinationId ? healthByDestination.get(destinationId) : undefined;

        if (health === 'INVALID') {
          this.log.warn(
            `[publication.schedule] skipping ${id}: destination ${destinationId} has INVALID credentials`,
          );
          // Move to FAILED so the row does not re-enter the scan window.
          // The operator can reset it to SCHEDULED after fixing the
          // credential.
          await publicationsRepo.markFailed(tx, id);
          blocked++;
          continue;
        }

        await outboxRepo.enqueue(tx, {
          queueName: 'content.publish',
          jobId: `content.publish:${id}`,
          payload: { publicationId: id },
        });
        enqueued++;
      }

      return { enqueued, blocked };
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
