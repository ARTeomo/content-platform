import type { SystemLogsRepository, TransactionManager } from '@content-platform/database';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogInput {
  level: LogLevel;
  event: string;
  message?: string;
  traceId?: string;
  contentId?: string;
  storyId?: string;
  sourceId?: string;
  jobId?: string;
  publicationId?: string;
  metadata?: Record<string, unknown>;
}

export interface SystemLogServiceDeps {
  txManager: TransactionManager;
  systemLogsRepo: SystemLogsRepository;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

/**
 * Best-effort writer for the `system_logs` table.
 *
 * Only high-value events belong here. Routine worker tracing stays on
 * stdout. A DB write failure is logged and swallowed.
 */
export class SystemLogService {
  private readonly logger: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(private readonly deps: SystemLogServiceDeps) {
    this.logger = deps.logger ?? console;
  }

  async log(input: LogInput): Promise<void> {
    try {
      await this.deps.txManager.run(async (tx) =>
        this.deps.systemLogsRepo.create(tx, {
          level: input.level,
          event: input.event,
          ...(input.message !== undefined && { message: input.message }),
          ...(input.traceId !== undefined && { traceId: input.traceId }),
          ...(input.contentId !== undefined && { contentId: input.contentId }),
          ...(input.storyId !== undefined && { storyId: input.storyId }),
          ...(input.sourceId !== undefined && { sourceId: input.sourceId }),
          ...(input.jobId !== undefined && { jobId: input.jobId }),
          ...(input.publicationId !== undefined && { publicationId: input.publicationId }),
          ...(input.metadata !== undefined && { metadata: input.metadata }),
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[system-log] failed to persist ${input.event}: ${msg}`);
    }
  }
}
