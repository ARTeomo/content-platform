import type { OutboxRepository } from '@content-platform/database';

export interface SystemOutboxCleanupJobData {
  retentionDays?: number;
}

export interface SystemOutboxCleanupServiceDeps {
  outboxRepo: OutboxRepository;
  defaultRetentionDays: number;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

/**
 * Deletes DISPATCHED outbox rows older than the retention window.
 *
 * Run by the dedicated `system.outbox.cleanup` worker instead of a
 * timer inside the dispatcher, so multiple dispatcher instances do
 * not race on the same DELETE and so the operation is observable
 * through the standard outbox pattern.
 */
export class SystemOutboxCleanupService {
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(private readonly deps: SystemOutboxCleanupServiceDeps) {
    this.log = deps.logger ?? console;
  }

  async cleanup(job: SystemOutboxCleanupJobData): Promise<{ deleted: number }> {
    const retentionDays = job.retentionDays ?? this.deps.defaultRetentionDays;
    const deleted = await this.deps.outboxRepo.cleanupOlderThan(retentionDays);
    if (deleted > 0) {
      this.log.info(
        `[system.outbox.cleanup] deleted ${deleted} DISPATCHED rows older than ${retentionDays} days`,
      );
    }
    return { deleted };
  }
}
