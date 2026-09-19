import { describe, expect, it, vi } from 'vitest';
import type {
  DestinationsRepository,
  ExternalInteractionsRepository,
  InteractionResponsesRepository,
  PublicationsRepository,
  Transaction,
  TransactionManager,
  WebhookDeliveriesRepository,
  WebhookEventsRepository,
} from '@content-platform/database';
import type { InteractionResponseService } from '../interaction-response/interaction-response-service.js';
import type {
  DecideOutcome,
  DestinationSnapshot,
  InteractionResponseConfig,
  InteractionSnapshot,
  TemplateMap,
} from '../interaction-response/types.js';
import { WebhookProcessService } from './webhook-process-service.js';
import type { ChangeExtractorRegistry } from './change-extractor.js';

// ---------- shared shapes ----------

interface FakeEventRow {
  id: string;
  status: string;
  destinationId: string | null;
  rawPayload: unknown;
}

interface FakeInteractionRow {
  id: string;
  destinationId: string | null;
  interactionType: string;
  externalInteractionId: string;
  actorExternalId: string | null;
  actorDisplayName: string | null;
  content: string | null;
  parentExternalId: string | null;
  publicationId: string | null;
  occurredAt: Date;
}

interface FakeDestinationRow {
  id: string;
  name: string;
  externalId: string;
}

interface FakeResponseRow {
  id: string;
  status: string;
  externalResponseId: string | null;
}

interface Harness {
  service: WebhookProcessService;
  decideSpy: ReturnType<typeof vi.fn>;
  markRespondedSpy: ReturnType<typeof vi.fn>;
  config: InteractionResponseConfig;
  templates: TemplateMap;
}

function makeTxManager(): TransactionManager {
  return {
    async run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
      return await fn({} as Transaction);
    },
  } as unknown as TransactionManager;
}

function envelopeWithComment(postId: string): unknown {
  return {
    object: 'page',
    entry: [
      {
        id: 'page-1',
        time: Math.floor(Date.now() / 1000),
        changes: [
          {
            field: 'feed',
            value: {
              item: 'comment',
              verb: 'add',
              comment_id: 'meta-c-1',
              post_id: postId,
              parent_id: `${postId}_${postId}`,
              from: { id: 'user-1', name: 'Alice' },
              message: 'thanks!',
              created_time: Math.floor(Date.now() / 1000),
            },
          },
        ],
      },
    ],
  };
}

function build(args: {
  event?: Partial<FakeEventRow>;
  destination?: FakeDestinationRow | null;
  upsertResult?: { interaction: FakeInteractionRow; skipped: boolean };
  existingResponse?: FakeResponseRow | undefined;
  decideOutcome?: DecideOutcome;
}): Harness {
  const event: FakeEventRow = {
    id: 'evt-1',
    status: 'RECEIVED',
    destinationId: 'dest-1',
    rawPayload: envelopeWithComment('post-1'),
    ...args.event,
  };

  const destination: FakeDestinationRow | null =
    args.destination === null
      ? null
      : (args.destination ?? {
          id: 'dest-1',
          name: 'Content Platform',
          externalId: 'page-1',
        });

  const interaction: FakeInteractionRow = args.upsertResult?.interaction ?? {
    id: 'int-1',
    destinationId: 'dest-1',
    interactionType: 'COMMENT',
    externalInteractionId: 'meta-c-1',
    actorExternalId: 'user-1',
    actorDisplayName: 'Alice',
    content: 'thanks!',
    parentExternalId: null,
    publicationId: null,
    occurredAt: new Date(),
  };

  const upsertResult = args.upsertResult ?? { interaction, skipped: false };

  const eventsRepo = {
    async findById(id: string): Promise<FakeEventRow | undefined> {
      return id === event.id ? event : undefined;
    },
    async markProcessing(_tx: unknown, id: string): Promise<void> {
      if (id === event.id) event.status = 'PROCESSING';
    },
    async markProcessed(_tx: unknown, id: string): Promise<void> {
      if (id === event.id) event.status = 'PROCESSED';
    },
    async markFailed(_tx: unknown, id: string): Promise<void> {
      if (id === event.id) event.status = 'FAILED';
    },
  } as unknown as WebhookEventsRepository;

  const deliveriesRepo = {
    async startAttempt(_tx: unknown): Promise<{ id: string }> {
      return { id: 'del-1' };
    },
    async finishSuccess(): Promise<void> {},
    async finishFailure(): Promise<void> {},
  } as unknown as WebhookDeliveriesRepository;

  const interactionsRepo = {
    async upsertMonotonic(): Promise<{ interaction: FakeInteractionRow; skipped: boolean }> {
      return upsertResult;
    },
  } as unknown as ExternalInteractionsRepository;

  const publicationsRepo = {
    async findIdByExternalPostId(): Promise<string | undefined> {
      return undefined;
    },
  } as unknown as PublicationsRepository;

  const destinationsRepo = {
    async findById(): Promise<FakeDestinationRow | undefined> {
      return destination ?? undefined;
    },
  } as unknown as DestinationsRepository;

  const markRespondedSpy = vi.fn(async (..._args: unknown[]) => {});
  const responsesRepo = {
    async findByDestinationAndExternalResponseId(): Promise<FakeResponseRow | undefined> {
      return args.existingResponse;
    },
    async markResponded(
      _tx: unknown,
      id: string,
      externalResponseId: string,
      respondedAt: Date,
    ): Promise<void> {
      markRespondedSpy(id, externalResponseId, respondedAt);
    },
  } as unknown as InteractionResponsesRepository;

  const decideSpy = vi.fn(async (): Promise<DecideOutcome> => {
    return args.decideOutcome ?? { kind: 'IGNORED', reason: 'test' };
  });
  const interactionResponseService = {
    decide: decideSpy,
  } as unknown as InteractionResponseService;

  const extractorRegistry = {
    get(field: string) {
      if (field !== 'feed') return undefined;
      return {
        async extract() {
          return [
            {
              destinationId: 'dest-1',
              webhookEventId: 'evt-1',
              interactionType: 'COMMENT',
              externalInteractionId: interaction.externalInteractionId,
              parentExternalId: undefined,
              actorExternalId: interaction.actorExternalId ?? undefined,
              actorDisplayName: interaction.actorDisplayName ?? undefined,
              content: interaction.content ?? undefined,
              permalink: undefined,
              occurredAt: interaction.occurredAt,
              rawMetadata: undefined,
            },
          ];
        },
      };
    },
  } as unknown as ChangeExtractorRegistry;

  const service = new WebhookProcessService({
    txManager: makeTxManager(),
    eventsRepo,
    deliveriesRepo,
    interactionsRepo,
    publicationsRepo,
    destinationsRepo,
    responsesRepo,
    extractorRegistry,
    interactionResponseService,
    interactionResponseConfig: {
      rules: [],
      maxResponsesPerHour: 20,
      minIntervalSeconds: 30,
    },
    templates: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });

  return {
    service,
    decideSpy,
    markRespondedSpy,
    config: { rules: [], maxResponsesPerHour: 20, minIntervalSeconds: 30 },
    templates: {},
  };
}

// ---------- tests ----------

describe('WebhookProcessService policy integration', () => {
  it('calls decide for each newly materialized interaction', async () => {
    const h = build({});
    const outcome = await h.service.processEvent('evt-1');
    expect(outcome.status).toBe('PROCESSED');
    expect(h.decideSpy).toHaveBeenCalledTimes(1);

    const args = h.decideSpy.mock.calls[0]![0] as {
      interaction: InteractionSnapshot;
      destination: DestinationSnapshot;
      config: InteractionResponseConfig;
      templates: TemplateMap;
    };
    expect(args.interaction.id).toBe('int-1');
    expect(args.interaction.interactionType).toBe('COMMENT');
    expect(args.interaction.externalInteractionId).toBe('meta-c-1');
    expect(args.destination.id).toBe('dest-1');
    expect(args.destination.name).toBe('Content Platform');
    expect(args.destination.trustLevel).toBe('MEDIUM');
  });

  it('does not call decide for stale upserts', async () => {
    const h = build({
      upsertResult: {
        interaction: {
          id: 'int-1',
          destinationId: 'dest-1',
          interactionType: 'COMMENT',
          externalInteractionId: 'meta-c-1',
          actorExternalId: 'user-1',
          actorDisplayName: 'Alice',
          content: 'thanks!',
          parentExternalId: null,
          publicationId: null,
          occurredAt: new Date(),
        },
        skipped: true,
      },
    });
    await h.service.processEvent('evt-1');
    expect(h.decideSpy).not.toHaveBeenCalled();
  });

  it('fails with UNKNOWN_DESTINATION when destination is missing', async () => {
    const h = build({ destination: null });
    const outcome = await h.service.processEvent('evt-1');
    expect(outcome.status).toBe('FAILED');
    if (outcome.status === 'FAILED') {
      expect(outcome.error).toBe('destination not found');
    }
    expect(h.decideSpy).not.toHaveBeenCalled();
  });

  it('push-reconciliation: marks an existing response RESPONDED and skips decide', async () => {
    const ownPage = 'page-1';
    const h = build({
      upsertResult: {
        interaction: {
          id: 'int-reply',
          destinationId: 'dest-1',
          interactionType: 'COMMENT',
          externalInteractionId: 'meta-reply-1',
          actorExternalId: ownPage,
          actorDisplayName: 'Content Platform',
          content: 'Hi Alice, thanks!',
          parentExternalId: 'meta-c-1',
          publicationId: null,
          occurredAt: new Date(),
        },
        skipped: false,
      },
      existingResponse: {
        id: 'resp-1',
        status: 'IN_PROGRESS',
        externalResponseId: 'meta-reply-1',
      },
    });
    const outcome = await h.service.processEvent('evt-1');
    expect(outcome.status).toBe('PROCESSED');
    expect(h.markRespondedSpy).toHaveBeenCalledTimes(1);
    expect(h.markRespondedSpy.mock.calls[0]![0]).toBe('resp-1');
    expect(h.markRespondedSpy.mock.calls[0]![1]).toBe('meta-reply-1');
    expect(h.decideSpy).not.toHaveBeenCalled();
  });

  it('push-reconciliation: skips decide when the actor is our own Page but no matching response exists', async () => {
    const ownPage = 'page-1';
    const h = build({
      upsertResult: {
        interaction: {
          id: 'int-reply',
          destinationId: 'dest-1',
          interactionType: 'COMMENT',
          externalInteractionId: 'meta-reply-2',
          actorExternalId: ownPage,
          actorDisplayName: 'Content Platform',
          content: 'Hi again!',
          parentExternalId: 'meta-c-1',
          publicationId: null,
          occurredAt: new Date(),
        },
        skipped: false,
      },
      existingResponse: undefined,
    });
    await h.service.processEvent('evt-1');
    expect(h.markRespondedSpy).not.toHaveBeenCalled();
    expect(h.decideSpy).not.toHaveBeenCalled();
  });

  it('push-reconciliation: does nothing when the existing response is already RESPONDED', async () => {
    const h = build({
      upsertResult: {
        interaction: {
          id: 'int-reply',
          destinationId: 'dest-1',
          interactionType: 'COMMENT',
          externalInteractionId: 'meta-reply-1',
          actorExternalId: 'page-1',
          actorDisplayName: 'Content Platform',
          content: 'Hi Alice, thanks!',
          parentExternalId: 'meta-c-1',
          publicationId: null,
          occurredAt: new Date(),
        },
        skipped: false,
      },
      existingResponse: {
        id: 'resp-1',
        status: 'RESPONDED',
        externalResponseId: 'meta-reply-1',
      },
    });
    await h.service.processEvent('evt-1');
    expect(h.markRespondedSpy).not.toHaveBeenCalled();
    expect(h.decideSpy).not.toHaveBeenCalled();
  });

  it('an inbound user comment still goes through the policy decision', async () => {
    const h = build({
      upsertResult: {
        interaction: {
          id: 'int-user',
          destinationId: 'dest-1',
          interactionType: 'COMMENT',
          externalInteractionId: 'meta-c-1',
          actorExternalId: 'user-1',
          actorDisplayName: 'Alice',
          content: 'thanks!',
          parentExternalId: null,
          publicationId: null,
          occurredAt: new Date(),
        },
        skipped: false,
      },
    });
    await h.service.processEvent('evt-1');
    expect(h.markRespondedSpy).not.toHaveBeenCalled();
    expect(h.decideSpy).toHaveBeenCalledTimes(1);
  });
});
