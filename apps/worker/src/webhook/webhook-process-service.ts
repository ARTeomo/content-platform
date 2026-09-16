import type {
  ExternalInteractionsRepository,
  PublicationsRepository,
  TransactionManager,
  WebhookDeliveriesRepository,
  WebhookEventsRepository,
} from '@content-platform/database';
import type { ChangeExtractorRegistry } from './change-extractor.js';
import type { MetaWebhookEnvelope } from './types.js';

export interface WebhookProcessServiceDeps {
  txManager: TransactionManager;
  eventsRepo: WebhookEventsRepository;
  deliveriesRepo: WebhookDeliveriesRepository;
  interactionsRepo: ExternalInteractionsRepository;
  publicationsRepo: PublicationsRepository;
  extractorRegistry: ChangeExtractorRegistry;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export type ProcessOutcome =
  | { status: 'PROCESSED'; interactionsCreated: number }
  | { status: 'FAILED'; error: string }
  | { status: 'SKIPPED'; reason: string };

/**
 * Process a single `webhook_events` row.
 *
 * This service is queue-agnostic. The BullMQ worker simply calls
 * `processEvent(id)`; the same service can be invoked from a manual
 * admin endpoint for reprocessing.
 *
 * ## Status flow
 *
 *   RECEIVED ──► PROCESSING ──┬──► PROCESSED
 *                             └──► FAILED (retry-eligible)
 *
 * Already-`PROCESSED` or `DEAD_LETTER` events are skipped silently.
 */
export class WebhookProcessService {
  private readonly deps: WebhookProcessServiceDeps;
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(deps: WebhookProcessServiceDeps) {
    this.deps = deps;
    this.log = deps.logger ?? console;
  }

  async processEvent(webhookEventId: string): Promise<ProcessOutcome> {
    const {
      eventsRepo,
      deliveriesRepo,
      interactionsRepo,
      publicationsRepo,
      extractorRegistry,
      txManager,
    } = this.deps;

    const event = await eventsRepo.findById(webhookEventId);
    if (!event) return { status: 'SKIPPED', reason: 'event not found' };
    if (event.status === 'PROCESSED') return { status: 'SKIPPED', reason: 'already processed' };
    if (event.status === 'DEAD_LETTER') return { status: 'SKIPPED', reason: 'dead letter' };
    if (!event.destinationId) {
      await this.failEvent(event.id, null, 'UNKNOWN_DESTINATION', 'Event has no destination id');
      return { status: 'FAILED', error: 'unknown destination' };
    }

    const destinationId = event.destinationId;

    // Start the attempt: atomically mark PROCESSING and record the
    // delivery row.
    const delivery = await txManager.run(async (tx) => {
      await eventsRepo.markProcessing(tx, event.id);
      return await deliveriesRepo.startAttempt(tx, {
        webhookEventId: event.id,
        workerId: 'webhook.process',
      });
    });

    const envelope = event.rawPayload as MetaWebhookEnvelope;
    if (!envelope || typeof envelope !== 'object' || !Array.isArray(envelope.entry)) {
      await this.failDelivery(
        delivery.id,
        event.id,
        'PAYLOAD_MALFORMED',
        'Envelope has no entry array',
      );
      return { status: 'FAILED', error: 'malformed envelope' };
    }

    let interactionsCreated = 0;
    const errors: string[] = [];

    for (const entry of envelope.entry) {
      if (!Array.isArray(entry.changes)) continue;

      for (const change of entry.changes) {
        const extractor = extractorRegistry.get(change.field);
        if (!extractor) continue;

        try {
          const drafts = await extractor.extract(change, {
            destinationId,
            webhookEventId: event.id,
            resolvePublicationId: (postId) =>
              publicationsRepo.findIdByExternalPostId(destinationId, postId),
          });

          for (const draft of drafts) {
            await txManager.run(async (tx) => {
              await interactionsRepo.upsertMonotonic(tx, draft);
            });
            interactionsCreated++;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${change.field}: ${msg}`);
          this.log.error(`[webhook.process] extraction failed: ${msg}`);
        }
      }
    }

    const finishedAt = new Date();

    if (errors.length > 0) {
      await this.failDelivery(delivery.id, event.id, 'PROCESSING_ERROR', errors.join('; '));
      return { status: 'FAILED', error: errors.join('; ') };
    }

    await txManager.run(async (tx) => {
      await eventsRepo.markProcessed(tx, event.id, finishedAt);
      await deliveriesRepo.finishSuccess(tx, delivery.id, finishedAt);
    });

    this.log.info(
      `[webhook.process] event ${event.id} processed: ${interactionsCreated} interactions`,
    );
    return { status: 'PROCESSED', interactionsCreated };
  }

  private async failEvent(
    eventId: string,
    deliveryId: string | null,
    category: string,
    message: string,
  ): Promise<void> {
    const { txManager, eventsRepo, deliveriesRepo } = this.deps;
    const at = new Date();
    await txManager.run(async (tx) => {
      await eventsRepo.markFailed(tx, eventId);
      if (deliveryId) {
        await deliveriesRepo.finishFailure(tx, deliveryId, at, 'FAILED', category, message);
      }
    });
  }

  private async failDelivery(
    deliveryId: string,
    eventId: string,
    category: string,
    message: string,
  ): Promise<void> {
    await this.failEvent(eventId, deliveryId, category, message);
  }
}
