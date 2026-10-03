import type { NotificationService } from './notification-service.js';
import type { SystemLogService } from './system-log-service.js';

export interface AlertingServiceDeps {
  notifications: NotificationService;
  logs: SystemLogService;
}

/**
 * Combines a notification (user-facing alert) with a system log
 * (durable forensic record) for the operational events that warrant
 * both.
 *
 * The two writes are independent best-effort operations. The
 * individual services already swallow their own failures.
 */
export class AlertingService {
  constructor(private readonly deps: AlertingServiceDeps) {}

  async credentialInvalidated(destinationId: string, reason: string): Promise<void> {
    await this.deps.notifications.notify({
      type: 'credential_failure',
      severity: 'CRITICAL',
      title: `Page Access Token invalidated for destination ${destinationId}`,
      message: `Reason: ${reason}. Outbound calls to this destination will fail until a new token is stored.`,
    });

    await this.deps.logs.log({
      level: 'error',
      event: 'credential.invalidated',
      message: `PAGE_ACCESS_TOKEN invalidated for destination ${destinationId}`,
      metadata: { destinationId, reason },
    });
  }

  async publicationFailed(
    publicationId: string,
    errorCategory: string,
    errorMessage: string,
  ): Promise<void> {
    await this.deps.notifications.notify({
      type: 'publication_failure',
      severity: 'ERROR',
      title: `Publication ${publicationId} failed`,
      message: `${errorCategory}: ${errorMessage}`,
      publicationId,
    });

    await this.deps.logs.log({
      level: 'error',
      event: 'publication.failed',
      message: `Publication ${publicationId} failed: ${errorCategory}`,
      publicationId,
      metadata: { errorCategory, errorMessage },
    });
  }

  async publicationPublished(publicationId: string, externalPostId: string): Promise<void> {
    await this.deps.logs.log({
      level: 'info',
      event: 'publication.published',
      message: `Publication ${publicationId} published as ${externalPostId}`,
      publicationId,
      metadata: { externalPostId },
    });
  }
}
