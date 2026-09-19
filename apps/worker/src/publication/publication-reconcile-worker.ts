import type { BullMqJobConsumer, JobConsumerJob } from '../queue/index.js';
import type { PublicationReconcileService } from './publication-reconcile-service.js';
import type { PublicationReconcileJobData, ReconcileOutcome } from './types.js';

export interface PublicationReconcileWorkerDeps {
  consumerFactory: (options: {
    queueName: string;
    processor: (job: JobConsumerJob<PublicationReconcileJobData>) => Promise<void>;
  }) => BullMqJobConsumer<PublicationReconcileJobData>;
  service: PublicationReconcileService;
}

const QUEUE_NAME = 'publication.reconcile';

/**
 * Queue consumer for `publication.reconcile`.
 *
 * A STILL_UNKNOWN outcome is rethrown so BullMQ applies its retry
 * backoff. A PUBLISHED, RETRY_ELIGIBLE, or SKIPPED outcome completes
 * the job successfully.
 */
export class PublicationReconcileWorker {
  private readonly consumer: BullMqJobConsumer<PublicationReconcileJobData>;

  constructor(deps: PublicationReconcileWorkerDeps) {
    this.consumer = deps.consumerFactory({
      queueName: QUEUE_NAME,
      processor: async (job) => {
        const outcome: ReconcileOutcome = await deps.service.reconcile(job.data);
        if (outcome.status === 'STILL_UNKNOWN') {
          throw new Error(`Reconciliation inconclusive: ${outcome.reason}`);
        }
      },
    });
  }

  async close(): Promise<void> {
    await this.consumer.close();
  }
}
