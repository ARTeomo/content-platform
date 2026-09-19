import type {
  DestinationsRepository,
  ExternalInteractionsRepository,
  InteractionResponsesRepository,
  PublicationsRepository,
  TransactionManager,
  WebhookDeliveriesRepository,
  WebhookEventsRepository,
} from '@content-platform/database';
import type { InteractionType } from '@content-platform/interaction-response';
import type { InteractionResponseService } from '../interaction-response/interaction-response-service.js';
import type {
  DestinationSnapshot,
  InteractionResponseConfig,
  InteractionSnapshot,
  TemplateMap,
} from '../interaction-response/types.js';
import type { ChangeExtractorRegistry } from './change-extractor.js';
import type { MetaWebhookEnvelope } from './types.js';

const DEFAULT_TRUST_LEVEL = 'MEDIUM' as const;

export interface WebhookProcessServiceDeps {
  txManager: TransactionManager;
  eventsRepo: WebhookEventsRepository;
  deliveriesRepo: WebhookDeliveriesRepository;
  interactionsRepo: ExternalInteractionsRepository;
  publicationsRepo: PublicationsRepository;
  destinationsRepo: DestinationsRepository;
  responsesRepo: InteractionResponsesRepository;
  extractorRegistry: ChangeExtractorRegistry;
  interactionResponseService: InteractionResponseService;
  interactionResponseConfig: InteractionResponseConfig;
  templates: TemplateMap;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export type ProcessOutcome =
  | { status: 'PROCESSED'; interactionsCreated: number }
  | { status: 'FAILED'; error: string }
  | { status: 'SKIPPED'; reason: string };

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
      destinationsRepo,
      responsesRepo,
      extractorRegistry,
      interactionResponseService,
      interactionResponseConfig,
      templates,
      txManager,
    } = this.deps;

    const event = await eventsRepo.findById(webhookEventId);
    if (!event) return { status: 'SKIPPED', reason: 'event not found' };
    if (event.status === 'PROCESSED') {
      return { status: 'SKIPPED', reason: 'already processed' };
    }
    if (event.status === 'DEAD_LETTER') {
      return { status: 'SKIPPED', reason: 'dead letter' };
    }

    const delivery = await txManager.run(async (tx) => {
      await eventsRepo.markProcessing(tx, event.id);
      return await deliveriesRepo.startAttempt(tx, {
        webhookEventId: event.id,
        workerId: 'webhook.process',
      });
    });

    if (!event.destinationId) {
      await this.failDelivery(
        delivery.id,
        event.id,
        'UNKNOWN_DESTINATION',
        'Event has no destination id',
      );
      this.log.warn(`[webhook.process] event ${event.id} failed: unknown destination`);
      return { status: 'FAILED', error: 'unknown destination' };
    }

    const destinationId = event.destinationId;

    const destination = await destinationsRepo.findById(destinationId);
    if (!destination) {
      await this.failDelivery(
        delivery.id,
        event.id,
        'UNKNOWN_DESTINATION',
        `Destination ${destinationId} not found`,
      );
      this.log.warn(
        `[webhook.process] event ${event.id} failed: destination ${destinationId} not found`,
      );
      return { status: 'FAILED', error: 'destination not found' };
    }

    const destinationSnapshot: DestinationSnapshot = {
      id: destination.id,
      name: destination.name,
      trustLevel: DEFAULT_TRUST_LEVEL,
    };

    const envelope = event.rawPayload as MetaWebhookEnvelope;
    if (!envelope || typeof envelope !== 'object' || !Array.isArray(envelope.entry)) {
      await this.failDelivery(
        delivery.id,
        event.id,
        'PAYLOAD_MALFORMED',
        'Envelope has no entry array',
      );
      this.log.warn(`[webhook.process] event ${event.id} failed: malformed envelope`);
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
              publicationsRepo.findIdByExternalPostId(postId, destinationId),
          });

          for (const draft of drafts) {
            const upsertResult = await txManager.run(async (tx) => {
              return await interactionsRepo.upsertMonotonic(tx, draft);
            });

            if (!upsertResult.skipped) {
              interactionsCreated++;
            }

            const interaction = upsertResult.interaction;

            // Push-reconciliation: the actor is our own Page. This means
            // the interaction is one of our own outbound replies coming
            // back as an inbound feed event. Match it to an existing
            // response and mark RESPONDED; never run the policy decision.
            if (
              interaction.actorExternalId !== null &&
              interaction.actorExternalId === destination.externalId
            ) {
              const existingResponse = await responsesRepo.findByDestinationAndExternalResponseId(
                destinationId,
                interaction.externalInteractionId,
              );
              if (existingResponse && existingResponse.status !== 'RESPONDED') {
                await txManager.run(async (tx) => {
                  await responsesRepo.markResponded(
                    tx,
                    existingResponse.id,
                    interaction.externalInteractionId,
                    new Date(),
                  );
                });
                this.log.info(
                  `[webhook.process] push-reconciliation: response ${existingResponse.id} marked RESPONDED (interaction ${interaction.id})`,
                );
              }
              continue;
            }

            // Stale upserts are already-decided interactions from a
            // previous run. Skip the policy decision.
            if (upsertResult.skipped) continue;

            const interactionSnapshot: InteractionSnapshot = {
              id: interaction.id,
              destinationId,
              interactionType: interaction.interactionType as InteractionType,
              externalInteractionId: interaction.externalInteractionId,
              actorExternalId: interaction.actorExternalId,
              actorDisplayName: interaction.actorDisplayName,
              content: interaction.content,
              parentExternalId: interaction.parentExternalId,
              publicationId: interaction.publicationId,
            };

            await interactionResponseService.decide({
              interaction: interactionSnapshot,
              destination: destinationSnapshot,
              publication: null,
              config: interactionResponseConfig,
              templates,
            });
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
      this.log.warn(`[webhook.process] event ${event.id} failed: ${errors.join('; ')}`);
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

  private async failDelivery(
    deliveryId: string,
    eventId: string,
    category: string,
    message: string,
  ): Promise<void> {
    const { txManager, eventsRepo, deliveriesRepo } = this.deps;
    const at = new Date();
    await txManager.run(async (tx) => {
      await eventsRepo.markFailed(tx, eventId);
      await deliveriesRepo.finishFailure(tx, deliveryId, at, 'FAILED', category, message);
    });
  }
}
