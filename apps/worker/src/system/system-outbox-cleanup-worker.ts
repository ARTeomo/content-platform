import type { BullMqJobConsumer, JobConsumerJob } from '../queue/index.js';
import type {
  SystemOutboxCleanupJobData,
  SystemOutboxCleanupService,
} from './system-outbox-cleanup-service.js';

export interface SystemOutboxCleanupWorkerDeps {
  consumerFactory: (options: {
    queueName: string;
    processor: (job: JobConsumerJob<SystemOutboxCleanupJobData>) => Promise<void>;
  }) => BullMqJobConsumer<SystemOutboxCleanupJobData>;
  service: SystemOutboxCleanupService;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

const QUEUE_NAME = 'system.outbox.cleanup';

export class SystemOutboxCleanupWorker {
  private readonly consumer: BullMqJobConsumer<SystemOutboxCleanupJobData>;

  constructor(deps: SystemOutboxCleanupWorkerDeps) {
    this.consumer = deps.consumerFactory({
      queueName: QUEUE_NAME,
      processor: async (job) => {
        await deps.service.cleanup(job.data);
      },
    });
  }

  async close(): Promise<void> {
    await this.consumer.close();
  }
}
