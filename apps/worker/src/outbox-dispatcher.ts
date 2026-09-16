import type { OutboxJob, OutboxRepository } from '@content-platform/database';
import type { JobQueue } from './queue/job-queue.js';
import type { WorkerConfig } from './config.js';

export interface OutboxDispatcherDeps {
  outboxRepo: OutboxRepository;
  queue: JobQueue;
  config: Pick<
    WorkerConfig,
    | 'outboxDispatchBatchSize'
    | 'outboxDispatchIdleBackoffMs'
    | 'outboxDispatchMaxAttempts'
    | 'outboxDispatchStaleThresholdSeconds'
    | 'outboxRecoveryIntervalSeconds'
    | 'outboxCleanupRetentionDays'
  >;
  /** Optional logger. Default: `console`. */
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

/**
 * Reads `outbox_jobs` and dispatches PENDING rows to the job queue.
 *
 * ## Loop
 *
 * 1. Claim a batch of PENDING rows via `FOR UPDATE SKIP LOCKED`.
 * 2. For each row, call `queue.add(name, payload, jobId)`.
 * 3. On success, mark the row DISPATCHED.
 * 4. On failure, mark the row PENDING (retry) or FAILED (max attempts).
 * 5. Periodically recover stale DISPATCHING rows and clean up old
 *    DISPATCHED rows.
 *
 * ## Idempotency
 *
 * The `jobId` is the BullMQ deduplication key. If the dispatcher is
 * restarted after a crash, re-enqueuing the same `jobId` does not create
 * a duplicate job — BullMQ rejects the duplicate silently.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §12.4
 */
export class OutboxDispatcher {
  private readonly outboxRepo: OutboxRepository;
  private readonly queue: JobQueue;
  private readonly config: OutboxDispatcherDeps['config'];
  private readonly logger: Pick<Console, 'info' | 'warn' | 'error'>;
  private stopped = false;
  private recoveryTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(deps: OutboxDispatcherDeps) {
    this.outboxRepo = deps.outboxRepo;
    this.queue = deps.queue;
    this.config = deps.config;
    this.logger = deps.logger ?? console;
  }

  /**
   * Start the dispatcher. Runs until `stop()` is called.
   */
  async start(): Promise<void> {
    this.stopped = false;
    this.scheduleRecovery();
    this.scheduleCleanup();

    this.logger.info('[outbox] dispatcher started');

    while (!this.stopped) {
      const dispatched = await this.dispatchOnce();
      if (dispatched === 0) {
        await sleep(this.config.outboxDispatchIdleBackoffMs);
      }
    }

    this.logger.info('[outbox] dispatcher stopped');
  }

  /**
   * Stop the dispatcher. Waits for the current batch to finish.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  /**
   * Run a single dispatch cycle.
   *
   * Returns the number of rows claimed and processed.
   */
  async dispatchOnce(): Promise<number> {
    const claimed = await this.outboxRepo.claimPendingBatch(this.config.outboxDispatchBatchSize);
    if (claimed.length === 0) return 0;

    for (const job of claimed) {
      await this.dispatchOne(job);
    }

    return claimed.length;
  }

  private async dispatchOne(job: OutboxJob): Promise<void> {
    try {
      await this.queue.add(job.queueName, job.payload, job.jobId);
      await this.outboxRepo.markDispatched(job.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[outbox] dispatch failed for job ${job.jobId}: ${message}`);
      await this.outboxRepo.markDispatchFailed(
        job.id,
        message,
        this.config.outboxDispatchMaxAttempts,
      );
    }
  }

  private scheduleRecovery(): void {
    const intervalMs = this.config.outboxRecoveryIntervalSeconds * 1000;
    this.recoveryTimer = setInterval(() => {
      void this.recoverStale();
    }, intervalMs);
  }

  private scheduleCleanup(): void {
    // Run cleanup once per hour.
    const intervalMs = 60 * 60 * 1000;
    this.cleanupTimer = setInterval(() => {
      void this.cleanup();
    }, intervalMs);
  }

  private async recoverStale(): Promise<void> {
    try {
      const recovered = await this.outboxRepo.recoverStale(
        this.config.outboxDispatchStaleThresholdSeconds,
      );
      if (recovered > 0) {
        this.logger.warn(`[outbox] recovered ${recovered} stale DISPATCHING rows`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[outbox] recovery failed: ${message}`);
    }
  }

  private async cleanup(): Promise<void> {
    try {
      const deleted = await this.outboxRepo.cleanupOlderThan(
        this.config.outboxCleanupRetentionDays,
      );
      if (deleted > 0) {
        this.logger.info(`[outbox] cleaned up ${deleted} DISPATCHED rows`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[outbox] cleanup failed: ${message}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
