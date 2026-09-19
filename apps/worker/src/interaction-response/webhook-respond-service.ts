import { createHash } from 'node:crypto';
import type {
  InteractionResponsesRepository,
  InteractionResponseAttemptsRepository,
  ExternalInteractionsRepository,
  TransactionManager,
} from '@content-platform/database';
import type { MetaInteractionAdapter } from '@content-platform/publishers';

export interface WebhookRespondServiceDeps {
  txManager: TransactionManager;
  responsesRepo: InteractionResponsesRepository;
  attemptsRepo: InteractionResponseAttemptsRepository;
  interactionsRepo: ExternalInteractionsRepository;
  adapter: MetaInteractionAdapter;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export type RespondOutcome =
  | { kind: 'SKIPPED'; reason: string }
  | { kind: 'RESPONDED'; externalResponseId: string }
  | { kind: 'RETRY'; errorCategory: string; errorMessage: string; retryAfterSeconds?: number }
  | { kind: 'FAILED'; errorCategory: string; errorMessage: string }
  | { kind: 'UNKNOWN'; errorCategory: string; errorMessage: string };

/**
 * Response send path. Invoked by the webhook.respond worker once per
 * response. Idempotent by construction:
 *
 *   - The claim step is atomic (single UPDATE ... WHERE status IN ...).
 *   - Concurrent workers will see 0 rows affected and skip.
 *
 * The service never throws for expected business errors. Only
 * unexpected I/O failures escape, so BullMQ can retry.
 */
export class WebhookRespondService {
  private readonly deps: WebhookRespondServiceDeps;
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(deps: WebhookRespondServiceDeps) {
    this.deps = deps;
    this.log = deps.logger ?? console;
  }

  async respond(responseId: string): Promise<RespondOutcome> {
    const { txManager, responsesRepo, attemptsRepo, interactionsRepo, adapter } = this.deps;

    // 1. Load the response.
    const response = await responsesRepo.findById(responseId);
    if (!response) {
      return { kind: 'SKIPPED', reason: 'response not found' };
    }

    // 2. Guard: already terminal.
    if (
      response.status === 'RESPONDED' ||
      response.status === 'REJECTED' ||
      response.status === 'FAILED' ||
      response.status === 'CANCELLED'
    ) {
      return { kind: 'SKIPPED', reason: `terminal status: ${response.status}` };
    }

    // 3. Body must be present.
    const body = response.body;
    if (body === null || body.length === 0) {
      return { kind: 'SKIPPED', reason: 'response has no body' };
    }

    // 4. Resolve the Meta-side comment id from the interaction.
    const interaction = await interactionsRepo.findById(response.interactionId);
    if (!interaction) {
      return {
        kind: 'SKIPPED',
        reason: `interaction ${response.interactionId} not found`,
      };
    }
    const commentId = interaction.externalInteractionId;

    // 5. Atomic claim.
    const claimed = await txManager.run(async (tx) =>
      responsesRepo.claimForResponding(tx, responseId, [
        'AUTO_RESPOND',
        'APPROVED',
        'SCHEDULED',
        'QUEUED',
        'RETRY',
      ]),
    );
    if (!claimed) {
      return { kind: 'SKIPPED', reason: 'already claimed by another worker' };
    }

    // 6. Compute the payload hash and start the attempt.
    const requestPayloadHash = this.hashBody(body);

    const attempt = await txManager.run(async (tx) =>
      attemptsRepo.startAttempt(tx, responseId, requestPayloadHash),
    );

    // 7. Call the external provider.
    const result = await adapter.replyToComment({
      destinationId: claimed.destinationId,
      commentId,
      body,
      requestPayloadHash,
    });

    const finishedAt = new Date();

    // 8. Dispatch on the adapter result.
    switch (result.status) {
      case 'SUCCESS': {
        await txManager.run(async (tx) =>
          responsesRepo.markResponded(tx, responseId, result.externalResponseId, finishedAt),
        );
        await txManager.run(async (tx) =>
          attemptsRepo.finishSuccess(tx, attempt.id, finishedAt, result.externalResponseId),
        );
        this.log.info(
          `[webhook.respond] response ${responseId} sent, external id ${result.externalResponseId}`,
        );
        return { kind: 'RESPONDED', externalResponseId: result.externalResponseId };
      }

      case 'RETRY': {
        await txManager.run(async (tx) => responsesRepo.markRetry(tx, responseId));
        await txManager.run(async (tx) =>
          attemptsRepo.finishFailure(
            tx,
            attempt.id,
            finishedAt,
            'RETRY',
            result.errorCategory,
            result.errorMessage,
          ),
        );
        this.log.warn(
          `[webhook.respond] response ${responseId} retry: ${result.errorCategory} — ${result.errorMessage}`,
        );
        return {
          kind: 'RETRY',
          errorCategory: result.errorCategory,
          errorMessage: result.errorMessage,
          ...(result.retryAfterSeconds !== undefined && {
            retryAfterSeconds: result.retryAfterSeconds,
          }),
        };
      }

      case 'FAILED': {
        await txManager.run(async (tx) => responsesRepo.markFailed(tx, responseId));
        await txManager.run(async (tx) =>
          attemptsRepo.finishFailure(
            tx,
            attempt.id,
            finishedAt,
            'FAILED',
            result.errorCategory,
            result.errorMessage,
          ),
        );
        this.log.error(
          `[webhook.respond] response ${responseId} failed: ${result.errorCategory} — ${result.errorMessage}`,
        );
        return {
          kind: 'FAILED',
          errorCategory: result.errorCategory,
          errorMessage: result.errorMessage,
        };
      }

      case 'UNKNOWN': {
        await txManager.run(async (tx) => responsesRepo.markUnknown(tx, responseId));
        await txManager.run(async (tx) =>
          attemptsRepo.finishFailure(
            tx,
            attempt.id,
            finishedAt,
            'UNKNOWN',
            result.errorCategory,
            result.errorMessage,
          ),
        );
        this.log.warn(
          `[webhook.respond] response ${responseId} unknown: ${result.errorCategory} — ${result.errorMessage}`,
        );
        return {
          kind: 'UNKNOWN',
          errorCategory: result.errorCategory,
          errorMessage: result.errorMessage,
        };
      }
    }
  }

  private hashBody(body: string): string {
    return `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`;
  }
}
