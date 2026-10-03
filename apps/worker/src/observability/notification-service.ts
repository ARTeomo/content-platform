import type { NotificationsRepository, TransactionManager } from '@content-platform/database';

export type NotificationType =
  | 'credential_failure'
  | 'publication_failure'
  | 'interaction_response_failure'
  | 'system_failure'
  | 'queue_backlog'
  | 'ai_budget_threshold'
  | 'source_failure';

export type NotificationSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

export interface NotifyInput {
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  sourceId?: string;
  contentId?: string;
  publicationId?: string;
}

export interface NotificationServiceDeps {
  txManager: TransactionManager;
  notificationsRepo: NotificationsRepository;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

/**
 * Best-effort writer for the `notifications` table.
 *
 * A failure to write a notification is logged but never propagates:
 * operational alerts must not fail the business operation that
 * triggered them.
 */
export class NotificationService {
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(private readonly deps: NotificationServiceDeps) {
    this.log = deps.logger ?? console;
  }

  async notify(input: NotifyInput): Promise<void> {
    try {
      await this.deps.txManager.run(async (tx) =>
        this.deps.notificationsRepo.create(tx, {
          type: input.type,
          severity: input.severity,
          title: input.title,
          message: input.message,
          ...(input.sourceId !== undefined && { sourceId: input.sourceId }),
          ...(input.contentId !== undefined && { contentId: input.contentId }),
          ...(input.publicationId !== undefined && { publicationId: input.publicationId }),
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(`[notification] failed to persist ${input.type}: ${msg}`);
    }
  }
}
