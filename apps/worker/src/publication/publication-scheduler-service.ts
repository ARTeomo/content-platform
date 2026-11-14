import {
  type NotificationsRepository,
  type OutboxRepository,
  type PublicationAttemptsRepository,
  type PublicationsRepository,
  type TransactionManager,
} from '@content-platform/database';
import type { MetaCredentialService, MetaCredentialStatus } from '@content-platform/authentication';
import type { AlertingService } from '../observability/index.js';

export interface PublicationSchedulerServiceDeps {
  txManager: TransactionManager;
  publicationsRepo: PublicationsRepository;
  publicationAttemptsRepo: PublicationAttemptsRepository;
  notificationsRepo: NotificationsRepository;
  outboxRepo: OutboxRepository;
  batchSize: number;
  /**
   * Publication-lifecycle staleness threshold, seconds. Configured via
   * PUBLICATION_RECONCILE_STALE_THRESHOLD_SECONDS (default 300); the same
   * existing threshold drives both the stale-RECONCILIATION sweep and the
   * stale-IN_PROGRESS crash recovery (C-D5) — no separate timeout.
   */
  staleThresholdSeconds: number;
  /**
   * C-D6 retry requeue bounds. `retryMaxAttempts` caps the number of
   * publication attempts (a row whose max attempt number has reached
   * the bound moves to FAILED/RETRY_EXHAUSTED instead of being
   * requeued). `retryBaseDelaySeconds` is the first backoff interval;
   * it doubles per attempt, capped at `retryMaxDelaySeconds`. Backoff
   * is measured from `updated_at`, which every RETRY transition bumps
   * in the same transaction (verified: ContentPublishService RETRY
   * branch, PublicationReconcileService RETRY_ELIGIBLE branch).
   */
  retryMaxAttempts: number;
  retryBaseDelaySeconds: number;
  retryMaxDelaySeconds: number;
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
  recoveredCount: number;
  retriedCount: number;
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
    const recoveredCount = await this.scanStaleInProgress();
    const retriedCount = await this.scanDueRetries();
    return {
      scheduledCount: scheduled.enqueued,
      reconciledCount,
      recoveredCount,
      retriedCount,
      blockedByCredentialCount: scheduled.blocked,
    };
  }

  private async scanScheduled(): Promise<{ enqueued: number; blocked: number }> {
    const {
      txManager,
      publicationsRepo,
      publicationAttemptsRepo,
      outboxRepo,
      batchSize,
      credentialService,
    } = this.deps;

    const blockedForNotification: Array<{
      publicationId: string;
      destinationId: string;
      reason: 'credential_invalid' | 'credential_unknown';
    }> = [];

    const result = await txManager.run(async (tx) => {
      const ids = await publicationsRepo.claimDueScheduled(tx, batchSize);
      if (ids.length === 0) return { enqueued: 0, blocked: 0 };

      const destinationByPublication = await publicationsRepo.findDestinationIdsByIds(tx, ids);

      // Attempt-scoped outbox jobIds (C-D6): the enqueue below and the
      // claim above share this transaction, so the number equals the
      // attempt the worker will actually start (startAttempt inserts
      // MAX(attempt_number) + 1). Attempt-less publications get :1.
      const maxAttemptById = await publicationAttemptsRepo.findMaxAttemptsByIds(tx, ids);

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
          // scan window and risk a loop. The CREDENTIAL_GATE category marks
          // these rows for the post-credential-fix requeue in the
          // credential store path (WP-11 J.3).
          await publicationsRepo.markFailed(tx, id, 'CREDENTIAL_GATE');
          blockedForNotification.push({ publicationId: id, destinationId, reason });
          blocked++;
          continue;
        }

        const nextAttempt = (maxAttemptById.get(id) ?? 0) + 1;
        await outboxRepo.enqueue(tx, {
          queueName: 'content.publish',
          jobId: `content.publish:${id}:${nextAttempt}`,
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
    const { txManager, publicationsRepo, outboxRepo, batchSize, staleThresholdSeconds } = this.deps;
    return await txManager.run(async (tx) => {
      const ids = await publicationsRepo.touchStaleReconciliation(
        tx,
        staleThresholdSeconds,
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

  /**
   * C-D5 crash recovery for publications stuck IN_PROGRESS.
   *
   * A worker that dies after the external API accepted the post but
   * before persisting the outcome leaves the publication IN_PROGRESS with
   * a PENDING attempt, forever. The external result is uncertain: it must
   * never be interpreted as success (a blind retry could duplicate the
   * post) and cannot be asserted as failure either. The safe terminal
   * state is FAILED + CRASH_RECOVERY, with the attempt finalized as
   * PROCESSING_TIMEOUT and exactly one publication_failure notification.
   * No retry is enqueued here; the operator resolves the destination
   * state (or a future reconciliation slice requeues explicitly).
   *
   * Two-phase claiming protocol:
   *  1. `findStaleInProgress` — plain read of candidate IDs, no locks.
   *  2. Per ID, one transaction runs the atomic conditional claim
   *     (`claimStaleInProgress`); only an ID the claim returned is
   *     processed. Attempt finalization and the notification are written
   *     in the SAME transaction as the claim, so a claimed publication
   *     yields exactly one notification and a rollback leaves no trace.
   *     The parent content_items row is never touched (J.2 is a
   *     success-path behavior only).
   */
  private async scanStaleInProgress(): Promise<number> {
    const {
      txManager,
      publicationsRepo,
      publicationAttemptsRepo,
      notificationsRepo,
      staleThresholdSeconds,
      batchSize,
    } = this.deps;

    const candidateIds = await publicationsRepo.findStaleInProgress(
      staleThresholdSeconds,
      batchSize,
    );

    const RECOVERY_MESSAGE =
      'Publication remained IN_PROGRESS beyond the staleness threshold; the executing ' +
      'worker is presumed crashed and the external outcome is uncertain. Marked FAILED ' +
      'without an automatic retry to avoid duplicate external posts.';

    let recovered = 0;
    for (const id of candidateIds) {
      const claimed = await txManager.run(async (tx) => {
        const won = await publicationsRepo.claimStaleInProgress(tx, id, staleThresholdSeconds);
        if (!won) return false;

        const at = new Date();
        const attempt = await publicationAttemptsRepo.findLatestForPublication(id);
        if (attempt && attempt.status === 'PENDING') {
          await publicationAttemptsRepo.finishFailure(
            tx,
            attempt.id,
            at,
            'FAILED',
            'PROCESSING_TIMEOUT',
            RECOVERY_MESSAGE,
          );
        }
        await notificationsRepo.create(tx, {
          type: 'publication_failure',
          severity: 'ERROR',
          title: `Publication ${id} marked FAILED after processing timeout`,
          message: `CRASH_RECOVERY: ${RECOVERY_MESSAGE}`,
          publicationId: id,
        });
        return true;
      });

      if (claimed) {
        recovered++;
        this.log.warn(`[publication.schedule] stale IN_PROGRESS ${id} → FAILED (CRASH_RECOVERY)`);
      }
    }
    return recovered;
  }

  /**
   * C-D6 automatic retry requeue for publications in RETRY.
   *
   * Two writers reach RETRY (ContentPublishService RETRY branch,
   * PublicationReconcileService RETRY_ELIGIBLE branch); both bump
   * `updated_at` in the same transaction, so `updated_at` is the
   * backoff clock. Per candidate, one transaction:
   *
   *  1. Exhaustion claim — while still RETRY and the attempt count has
   *     reached the bound: FAILED + RETRY_EXHAUSTED with exactly one
   *     notification in the same transaction; alerting after commit.
   *     Never enqueued again (the J.3 hook matches CREDENTIAL_GATE
   *     only, so these rows are not picked up there either).
   *  2. Due-retry claim — while still RETRY, under the bound, and past
   *     the exponential backoff (`min(max, base * 2^(maxAttempt-1))`):
   *     flip to SCHEDULED (J.3-style; NO enqueue here). Scan 1 picks
   *     the row up on a later tick and enqueues with the
   *     attempt-scoped jobId.
   *
   * Uncertain-outcome semantics from package 2 are preserved:
   * FAILED + CRASH_RECOVERY rows are never touched by this scan, and
   * the parent content_items row is never modified here.
   */
  private async scanDueRetries(): Promise<number> {
    const {
      txManager,
      publicationsRepo,
      publicationAttemptsRepo,
      notificationsRepo,
      alerting,
      batchSize,
      retryMaxAttempts,
      retryBaseDelaySeconds,
      retryMaxDelaySeconds,
    } = this.deps;

    const candidates = await publicationsRepo.findRetryCandidates(batchSize);

    let retried = 0;
    for (const candidate of candidates) {
      const outcome = await txManager.run(async (tx) => {
        const maxAttempt = await publicationAttemptsRepo.findMaxAttempt(tx, candidate.id);

        const exhausted = await publicationsRepo.claimRetryExhausted(
          tx,
          candidate.id,
          retryMaxAttempts,
        );
        if (exhausted) {
          const message =
            `RETRY_EXHAUSTED: publication exhausted its retry budget after ` +
            `${maxAttempt} attempt(s) (bound ${retryMaxAttempts}) without a successful ` +
            `publication. The row was moved to FAILED and will not be retried automatically.`;
          await notificationsRepo.create(tx, {
            type: 'publication_failure',
            severity: 'ERROR',
            title: `Publication ${candidate.id} retry attempts exhausted`,
            message,
            publicationId: candidate.id,
          });
          return { kind: 'EXHAUSTED' as const, message };
        }

        if (maxAttempt >= retryMaxAttempts) return { kind: 'SKIP' as const };

        const exponent = Math.max(maxAttempt, 1) - 1;
        const delaySeconds = Math.min(retryMaxDelaySeconds, retryBaseDelaySeconds * 2 ** exponent);
        const due = await publicationsRepo.claimRetryDue(
          tx,
          candidate.id,
          retryMaxAttempts,
          delaySeconds,
        );
        return due ? { kind: 'SCHEDULED' as const } : { kind: 'SKIP' as const };
      });

      if (outcome.kind === 'EXHAUSTED') {
        this.log.warn(
          `[publication.schedule] RETRY ${candidate.id} → FAILED (RETRY_EXHAUSTED after ${retryMaxAttempts} attempts)`,
        );
        if (alerting) {
          await alerting.publicationFailed(candidate.id, 'RETRY_EXHAUSTED', outcome.message);
        }
      } else if (outcome.kind === 'SCHEDULED') {
        retried++;
      }
    }
    return retried;
  }
}
