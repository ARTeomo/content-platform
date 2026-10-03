import type { JobConsumer } from '../queue/job-consumer.js';
import { invalidatePageAccessToken } from '../credentials/get-access-token.js';
import type { MetaCredentialServiceBundle } from '../credentials/meta-credential-bridge.js';
import type { AlertingService } from '../observability/index.js';
import type { ContentPublishService } from './content-publish-service.js';
import type { ContentPublishJobData } from './types.js';

export interface ContentPublishWorkerDeps {
  consumerFactory: (options: {
    queueName: string;
    processor: (job: { id: string; data: ContentPublishJobData }) => Promise<void>;
  }) => JobConsumer<ContentPublishJobData>;
  service: ContentPublishService;
  credentialBundle: MetaCredentialServiceBundle;
  alerting?: AlertingService;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export class ContentPublishWorker {
  private readonly consumer: JobConsumer<ContentPublishJobData>;
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(deps: ContentPublishWorkerDeps) {
    this.log = deps.logger ?? console;

    this.consumer = deps.consumerFactory({
      queueName: 'content.publish',
      processor: async (job) => {
        const outcome = await deps.service.publish(job.data);
        this.log.info(`[content.publish] job ${job.id} → ${outcome.status}`);

        if (outcome.status === 'FAILED' && outcome.shouldInvalidateCredential) {
          await invalidatePageAccessToken(
            deps.credentialBundle,
            outcome.destinationId,
            `publish_${outcome.errorCategory}`,
            this.log,
          );
          if (deps.alerting) {
            await deps.alerting.credentialInvalidated(
              outcome.destinationId,
              `publish_${outcome.errorCategory}`,
            );
          }
        }

        if (outcome.status === 'RETRY') {
          throw new Error(`retryable: ${outcome.errorCategory}`);
        }
      },
    });
  }

  async close(): Promise<void> {
    await this.consumer.close();
  }
}
