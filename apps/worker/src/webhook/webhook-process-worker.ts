import type { BullMqJobConsumer } from '../queue/index.js';
import type { WebhookProcessService } from './webhook-process-service.js';

export interface WebhookProcessJobData {
  webhookEventId: string;
}

export interface WebhookProcessWorkerDeps {
  consumerFactory: (options: {
    queueName: string;
    processor: (job: { id: string; data: WebhookProcessJobData }) => Promise<void>;
  }) => BullMqJobConsumer<WebhookProcessJobData>;
  service: WebhookProcessService;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

/**
 * BullMQ wrapper for the `webhook.process` queue.
 *
 * The processor receives `{ webhookEventId }` and delegates to
 * `WebhookProcessService`. On failure, the service has already updated
 * `webhook_events` and `webhook_deliveries`; the BullMQ retry policy
 * decides whether to run again.
 */
export class WebhookProcessWorker {
  private readonly consumer: BullMqJobConsumer<WebhookProcessJobData>;
  private readonly service: WebhookProcessService;
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(deps: WebhookProcessWorkerDeps) {
    this.service = deps.service;
    this.log = deps.logger ?? console;

    this.consumer = deps.consumerFactory({
      queueName: 'webhook.process',
      processor: async (job) => {
        const outcome = await this.service.processEvent(job.data.webhookEventId);
        if (outcome.status === 'FAILED') {
          // Throw so that BullMQ retries the job.
          throw new Error(outcome.error);
        }
      },
    });
  }

  async close(): Promise<void> {
    await this.consumer.close();
  }
}
