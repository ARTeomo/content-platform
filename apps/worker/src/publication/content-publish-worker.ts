import type { JobConsumer } from '../queue/job-consumer.js';
import type { ContentPublishService } from './content-publish-service.js';
import type { ContentPublishJobData } from './types.js';

export interface ContentPublishWorkerDeps {
  consumerFactory: (options: {
    queueName: string;
    processor: (job: { id: string; data: ContentPublishJobData }) => Promise<void>;
  }) => JobConsumer<ContentPublishJobData>;
  service: ContentPublishService;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

/**
 * BullMQ consumer for the `content.publish` queue.
 *
 * Each job carries a single publicationId. The service handles the
 * state machine and calls the Meta publisher adapter.
 */
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
      },
    });
  }

  async close(): Promise<void> {
    await this.consumer.close();
  }
}
