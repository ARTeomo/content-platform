import {
  OutboxRepository,
  PublicationsRepository,
  TransactionManager,
} from '@content-platform/database';
import type { MetaCredentialService, MetaCredentialStatus } from '@content-platform/authentication';
import type { AlertingService } from '../observability/index.js';

export interface PublicationSchedulerServiceDeps {
  txManager: TransactionManager;
  publicationsRepo: PublicationsRepository;
  outboxRepo: OutboxRepository;
  batchSize: number;
  reconcileStaleThresholdSeconds: number;
  /**
   * Mandatory credential health gate. The worker bootstrap refuses to
   * start when the credential bundle is unavailable; see
   * apps/worker/src/index.ts.
   */
  credentialService: MetaCredentialService;
  alerting?: AlertingService;
  /**
   * Deduplication window for blocked-publication alerts, ms. Default 6h.
   * In-memory only — the current topology is a single worker process.
   */
  notificationDedupWindowMs?: number;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface PublicationSchedulerRunResult {
  scheduledCount: number;
  reconciledCount: number;
  blockedByCredentialCount: number;
}

const DEFAULT_NOTIFICATION_DEDUP_WINDOW_MS = 6 * 60 * 60 * 1000;

export class PublicationSchedulerService {
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;
  private readonly notificationDedupWindowMs: number;
  /** destinationId → epoch ms of the last blocked-publication alert. */
  private readonly lastBlockedAlertAt = new Map<string, number>();

  constructor(private readonly deps: PublicationSchedulerServiceDeps) {
    this.log = deps.logger ?? console;
    this.notificationDedupWindowMs =
      deps.notificationDedupWindowMs ?? DEFAULT_NOTIFICATION_DEDUP_WINDOW_MS;
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

    const blockedForNotification: Array<{
      publicationId: string;
      destinationId: string;
      reason: 'credential_invalid' | 'credential_unknown';
    }> = [];

    const result = await txManager.run(async (tx) => {
      const ids = await publicationsRepo.claimDueScheduled(tx, batchSize);
      if (ids.length === 0) return { enqueued: 0, blocked: 0 };

      const destinationByPublication = await publicationsRepo.findDestinationIdsByIds(tx, ids);

      const healthByDestination = new Map<string, MetaCredentialStatus>();
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

      let enqueued = 0;
      let blocked = 0;

      for (const id of ids) {
        const destinationId = destinationByPublication.get(id);
        const health = destinationId ? healthByDestination.get(destinationId) : undefined;

        // Block on INVALID (definitive) and UNKNOWN (transient/unknown).
        // Both mean the credential cannot be trusted right now.
        if (destinationId && (health === 'INVALID' || health === 'UNKNOWN')) {
          const reason: 'credential_invalid' | 'credential_unknown' =
            health === 'INVALID' ? 'credential_invalid' : 'credential_unknown';
          this.log.warn(
            `[publication.schedule] skipping ${id}: destination ${destinationId} credentials are ${health}`,
          );
          // FAILED is terminal: resetting to SCHEDULED would re-enter the
          // scan window and risk a loop.
          await publicationsRepo.markFailed(tx, id);
          blockedForNotification.push({ publicationId: id, destinationId, reason });
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

    // At most one alert per destination per dedup window.
    if (this.deps.alerting && blockedForNotification.length > 0) {
      const now = Date.now();
      const sentThisTick = new Set<string>();
      for (const { publicationId, destinationId, reason } of blockedForNotification) {
        if (sentThisTick.has(destinationId)) continue;
        const last = this.lastBlockedAlertAt.get(destinationId);
        if (last !== undefined && now - last < this.notificationDedupWindowMs) continue;
        sentThisTick.add(destinationId);
        this.lastBlockedAlertAt.set(destinationId, now);
        await this.deps.alerting.publicationBlocked(publicationId, destinationId, reason);
      }
    }

    return result;
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
