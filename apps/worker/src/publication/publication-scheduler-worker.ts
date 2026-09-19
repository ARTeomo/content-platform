import type { PublicationSchedulerService } from './publication-scheduler-service.js';

export interface PublicationSchedulerWorkerOptions {
  scheduler: PublicationSchedulerService;
  /** Polling interval in milliseconds. */
  intervalMs: number;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

/**
 * Periodic polling worker for the publication scheduler.
 *
 * The worker owns the timer, runs the scheduler service, and logs a
 * summary line only when something was actually claimed. Errors are
 * logged but never crash the worker; the next tick retries.
 *
 * `setTimeout` is used rather than `setInterval` so a slow scan cannot
 * overlap with the next run.
 */
export class PublicationSchedulerWorker {
  private timer: NodeJS.Timeout | null = null;
  private shuttingDown = false;
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(private readonly options: PublicationSchedulerWorkerOptions) {
    this.log = options.logger ?? console;
  }

  start(): void {
    if (this.timer) return;
    this.log.info(
      `[publication.schedule] scheduler started (interval=${this.options.intervalMs}ms)`,
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
      const result = await this.options.scheduler.runOnce();
      if (result.scheduledCount > 0 || result.reconciledCount > 0) {
        this.log.info(
          `[publication.schedule] scheduled=${result.scheduledCount} reconciled=${result.reconciledCount}`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(`[publication.schedule] scan failed: ${msg}`);
    }

    if (!this.shuttingDown) {
      this.timer = setTimeout(() => void this.tick(), this.options.intervalMs);
    }
  }
}
