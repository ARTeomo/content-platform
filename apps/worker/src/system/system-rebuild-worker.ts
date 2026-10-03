import type { BullMqJobConsumer, JobConsumerJob } from '../queue/index.js';
import type { SystemRebuildJobData, SystemRebuildService } from './system-rebuild-service.js';

export interface SystemRebuildWorkerDeps {
  consumerFactory: (options: {
    queueName: string;
    processor: (job: JobConsumerJob<SystemRebuildJobData>) => Promise<void>;
  }) => BullMqJobConsumer<SystemRebuildJobData>;
  service: SystemRebuildService;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

const QUEUE_NAME = 'system.rebuild';

/**
 * Consumer for the `system.rebuild` queue.
 *
 * The rebuild is a safety net, not a critical path. It never throws
 * for expected outcomes; unexpected I/O failures propagate so BullMQ
 * can retry.
 */
export class SystemRebuildWorker {
  private readonly consumer: BullMqJobConsumer<SystemRebuildJobData>;
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(deps: SystemRebuildWorkerDeps) {
    this.log = deps.logger ?? console;
    this.consumer = deps.consumerFactory({
      queueName: QUEUE_NAME,
      processor: async (job) => {
        const outcome = await deps.service.rebuild(job.data);
        this.log.info(
          `[system.rebuild] job ${job.id} → webhook_events=${outcome.webhookEventsReenqueued} publications=${outcome.publicationsReenqueued} responses=${outcome.interactionResponsesReenqueued}`,
        );
      },
    });
  }

  async close(): Promise<void> {
    await this.consumer.close();
  }
}
