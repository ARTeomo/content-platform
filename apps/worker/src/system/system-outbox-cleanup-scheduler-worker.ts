import type { OutboxRepository, TransactionManager } from '@content-platform/database';

export interface SystemOutboxCleanupSchedulerWorkerOptions {
  txManager: TransactionManager;
  outboxRepo: OutboxRepository;
  /** Polling interval in milliseconds. Zero disables the scheduler. */
  intervalMs: number;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

/**
 * Periodic polling worker that enqueues `system.outbox.cleanup` jobs.
 *
 * Uses `setTimeout` chaining so a slow scan cannot overlap with the
 * next tick. When `intervalMs` is zero, `start()` is a no-op and the
 * scheduler must be triggered manually.
 */
export class SystemOutboxCleanupSchedulerWorker {
  private timer: NodeJS.Timeout | null = null;
  private shuttingDown = false;
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(private readonly options: SystemOutboxCleanupSchedulerWorkerOptions) {
    this.log = options.logger ?? console;
  }

  start(): void {
    if (this.options.intervalMs <= 0) {
      this.log.info('[system.outbox.cleanup.schedule] disabled (interval=0)');
      return;
    }
    if (this.timer) return;
    this.log.info(
      `[system.outbox.cleanup.schedule] started (interval=${this.options.intervalMs}ms)`,
    );
    void this.tick();
  }

  async stop(): Promise<void> {
    this.shuttingDown = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.shuttingDown) return;

    try {
      const ts = Date.now();
      await this.options.txManager.run(async (tx) => {
        await this.options.outboxRepo.enqueue(tx, {
          queueName: 'system.outbox.cleanup',
          jobId: `system.outbox.cleanup:${ts}`,
          payload: {},
        });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(`[system.outbox.cleanup.schedule] enqueue failed: ${msg}`);
    }

    if (!this.shuttingDown) {
      this.timer = setTimeout(() => void this.tick(), this.options.intervalMs);
    }
  }
}
