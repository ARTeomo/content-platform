import type { WebhookRespondReconcileService } from './webhook-respond-reconcile-service.js';

export interface WebhookRespondReconcileJobData {
  responseId: string;
}

export interface ReconcileConsumerLike {
  close(): Promise<void>;
}

export interface WebhookRespondReconcileWorkerDeps {
  consumerFactory: (options: {
    queueName: string;
    processor: (job: {
      id: string | undefined;
      data: WebhookRespondReconcileJobData;
    }) => Promise<void>;
  }) => ReconcileConsumerLike;
  service: WebhookRespondReconcileService;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export const WEBHOOK_RESPOND_RECONCILE_QUEUE = 'webhook.respond.reconcile';

/**
 * Worker for pull-based reconciliation of uncertain responses.
 *
 * Never throws for expected outcomes. Job failures (unexpected I/O)
 * bubble up to BullMQ and are retried with backoff.
 */
export class WebhookRespondReconcileWorker {
  private readonly consumer: ReconcileConsumerLike;
  private readonly service: WebhookRespondReconcileService;
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(deps: WebhookRespondReconcileWorkerDeps) {
    this.service = deps.service;
    this.log = deps.logger ?? console;
    this.consumer = deps.consumerFactory({
      queueName: WEBHOOK_RESPOND_RECONCILE_QUEUE,
      processor: async (job) => {
        await this.process(job);
      },
    });
  }

  async close(): Promise<void> {
    await this.consumer.close();
  }

  private async process(job: {
    id: string | undefined;
    data: WebhookRespondReconcileJobData;
  }): Promise<void> {
    const responseId = job.data.responseId;
    if (!responseId || responseId.length === 0) {
      this.log.error(
        `[webhook.respond.reconcile] job ${job.id ?? '<unknown>'} has no responseId; skipping`,
      );
      return;
    }

    const outcome = await this.service.reconcile(responseId);

    switch (outcome.kind) {
      case 'SKIPPED':
        this.log.info(
          `[webhook.respond.reconcile] job ${job.id ?? '<unknown>'} skipped: ${outcome.reason}`,
        );
        return;
      case 'RESPONDED':
        this.log.info(
          `[webhook.respond.reconcile] job ${job.id ?? '<unknown>'} resolved: ${outcome.externalResponseId}`,
        );
        return;
      case 'RETRY_ENQUEUED':
        this.log.info(`[webhook.respond.reconcile] job ${job.id ?? '<unknown>'} retry enqueued`);
        return;
      case 'STILL_UNKNOWN':
        this.log.warn(
          `[webhook.respond.reconcile] job ${job.id ?? '<unknown>'} still unknown: ${outcome.reason}`,
        );
        return;
    }
  }
}
