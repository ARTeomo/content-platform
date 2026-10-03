import { invalidatePageAccessToken } from '../credentials/get-access-token.js';
import type { MetaCredentialServiceBundle } from '../credentials/meta-credential-bridge.js';
import type { WebhookRespondService } from './webhook-respond-service.js';

export interface WebhookRespondJobData {
  responseId: string;
}

export interface RespondConsumerLike {
  close(): Promise<void>;
}

export interface WebhookRespondWorkerDeps {
  consumerFactory: (options: {
    queueName: string;
    processor: (job: { id: string | undefined; data: WebhookRespondJobData }) => Promise<void>;
  }) => RespondConsumerLike;
  service: WebhookRespondService;
  credentialBundle: MetaCredentialServiceBundle;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export const WEBHOOK_RESPOND_QUEUE = 'webhook.respond';

/**
 * Worker for outbound interaction responses.
 *
 * Outcome handling:
 *
 *   - RESPONDED / SKIPPED / UNKNOWN
 *       → job completes successfully. UNKNOWN is picked up by the
 *         reconciliation path.
 *
 *   - FAILED
 *       → job completes successfully. If flagged, the destination's
 *         PAGE_ACCESS_TOKEN is invalidated so the scheduler and
 *         adapter skip it.
 *
 *   - RETRY
 *       → the worker throws, so BullMQ reschedules with backoff.
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
        await this.process(job, deps.credentialBundle);
      },
    });
  }

  async close(): Promise<void> {
    await this.consumer.close();
  }

  private async process(
    job: { id: string | undefined; data: WebhookRespondJobData },
    credentialBundle: MetaCredentialServiceBundle,
  ): Promise<void> {
    const responseId = job.data.responseId;
    if (!responseId || responseId.length === 0) {
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

      case 'FAILED': {
        this.log.error(
          `[webhook.respond] job ${job.id ?? '<unknown>'} failed: ${outcome.errorCategory} — ${outcome.errorMessage}`,
        );
        if (outcome.shouldInvalidateCredential) {
          await invalidatePageAccessToken(
            credentialBundle,
            outcome.destinationId,
            `respond_${outcome.errorCategory}`,
            this.log,
          );
        }
        return;
      }

      case 'UNKNOWN':
        this.log.warn(
          `[webhook.respond] job ${job.id ?? '<unknown>'} unknown: ${outcome.errorCategory} — ${outcome.errorMessage}`,
        );
        return;

      case 'RETRY': {
        this.log.warn(
          `[webhook.respond] job ${job.id ?? '<unknown>'} retry: ${outcome.errorCategory} — ${outcome.errorMessage}`,
        );
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
