import type { WebhookRespondService } from './webhook-respond-service.js';

/**
 * BullMQ job payload for the `webhook.respond` queue.
 *
 * Carries only the response UUID; the service loads the full record.
 * Never embeds the body or other large content.
 */
export interface WebhookRespondJobData {
  responseId: string;
}

/**
 * Minimal consumer shape the worker depends on. This is what
 * `BullMqJobConsumer` satisfies; the interface exists so tests can
 * supply a fake without touching Redis.
 */
export interface RespondConsumerLike {
  close(): Promise<void>;
}

export interface WebhookRespondWorkerDeps {
  /**
   * Factory that constructs a BullMQ consumer for the given queue.
   * The worker calls this exactly once, in its constructor.
   */
  consumerFactory: (options: {
    queueName: string;
    processor: (job: { id: string | undefined; data: WebhookRespondJobData }) => Promise<void>;
  }) => RespondConsumerLike;
  service: WebhookRespondService;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export const WEBHOOK_RESPOND_QUEUE = 'webhook.respond';

/**
 * Worker for outbound interaction responses.
 *
 * Outcome handling:
 *
 *   - RESPONDED / SKIPPED / FAILED / UNKNOWN
 *       → the job completes successfully. FAILED and UNKNOWN are terminal
 *         states from the worker's perspective; UNKNOWN is picked up by
 *         the reconciliation path, FAILED is a permanent error.
 *
 *   - RETRY
 *       → the worker throws, so BullMQ reschedules the job with backoff.
 *         The `WebhookRespondService` has already moved the response
 *         record to the RETRY state, so the next attempt will find it
 *         eligible to claim again.
 *
 * The worker never re-throws for terminal outcomes, so BullMQ will not
 * spin on a permanent failure.
 */
export class WebhookRespondWorker {
  private readonly consumer: RespondConsumerLike;
  private readonly service: WebhookRespondService;
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(deps: WebhookRespondWorkerDeps) {
    this.service = deps.service;
    this.log = deps.logger ?? console;
    this.consumer = deps.consumerFactory({
      queueName: WEBHOOK_RESPOND_QUEUE,
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
    data: WebhookRespondJobData;
  }): Promise<void> {
    const responseId = job.data.responseId;
    if (!responseId || responseId.length === 0) {
      // A malformed job is not retryable — log and return so BullMQ
      // does not spin.
      this.log.error(`[webhook.respond] job ${job.id ?? '<unknown>'} has no responseId; skipping`);
      return;
    }

    const outcome = await this.service.respond(responseId);

    switch (outcome.kind) {
      case 'SKIPPED':
        this.log.info(`[webhook.respond] job ${job.id ?? '<unknown>'} skipped: ${outcome.reason}`);
        return;

      case 'RESPONDED':
        this.log.info(
          `[webhook.respond] job ${job.id ?? '<unknown>'} responded: ${outcome.externalResponseId}`,
        );
        return;

      case 'FAILED':
        this.log.error(
          `[webhook.respond] job ${job.id ?? '<unknown>'} failed: ${outcome.errorCategory} — ${outcome.errorMessage}`,
        );
        // Terminal from the worker's perspective. Do not throw.
        return;

      case 'UNKNOWN':
        this.log.warn(
          `[webhook.respond] job ${job.id ?? '<unknown>'} unknown: ${outcome.errorCategory} — ${outcome.errorMessage}`,
        );
        // Reconciliation will pick this up. Do not throw.
        return;

      case 'RETRY': {
        this.log.warn(
          `[webhook.respond] job ${job.id ?? '<unknown>'} retry: ${outcome.errorCategory} — ${outcome.errorMessage}`,
        );
        // Throw so BullMQ reschedules the job. The response record is
        // already in the RETRY state, so the next attempt will find it
        // claimable.
        const err = new Error(`retryable: ${outcome.errorCategory}: ${outcome.errorMessage}`);
        if (outcome.retryAfterSeconds !== undefined) {
          (err as Error & { retryAfterSeconds?: number }).retryAfterSeconds =
            outcome.retryAfterSeconds;
        }
        throw err;
      }
    }
  }
}
