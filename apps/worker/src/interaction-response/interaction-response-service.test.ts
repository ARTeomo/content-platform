import { describe, expect, it, vi } from 'vitest';
import type {
  InteractionResponsesRepository,
  OutboxRepository,
  Transaction,
  TransactionManager,
} from '@content-platform/database';
import { InteractionResponseService } from './interaction-response-service.js';
import type {
  DestinationSnapshot,
  InteractionResponseConfig,
  InteractionSnapshot,
  TemplateMap,
} from './types.js';

interface FakeResponseRow {
  id: string;
  interactionId: string;
  destinationId: string;
  templateId: string | null;
  templateVersion: number;
  body: string | null;
  status: string;
  scheduledAt: Date | null;
  respondedAt: Date | null;
  externalResponseId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function makeTxManager(): TransactionManager {
  return {
    async run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
      return await fn({} as Transaction);
    },
  } as unknown as TransactionManager;
}

interface FakeEnv {
  repo: InteractionResponsesRepository;
  outbox: OutboxRepository;
  rows: FakeResponseRow[];
  enqueued: { queueName: string; jobId: string }[];
  recentCount: number;
}

function makeEnv(): FakeEnv {
  const rows: FakeResponseRow[] = [];
  const enqueued: { queueName: string; jobId: string }[] = [];
  const state: FakeEnv = {
    rows,
    enqueued,
    recentCount: 0,
    repo: undefined as unknown as InteractionResponsesRepository,
    outbox: undefined as unknown as OutboxRepository,
  };
  const now = new Date();

  const repo = {
    async findByInteractionId(interactionId: string): Promise<FakeResponseRow | undefined> {
      return rows.find((r) => r.interactionId === interactionId);
    },
    async countRecentByDestination(): Promise<number> {
      return state.recentCount;
    },
    async create(
      _tx: unknown,
      input: {
        interactionId: string;
        destinationId: string;
        templateId?: string;
        body?: string;
        status?: string;
      },
    ): Promise<FakeResponseRow> {
      const row: FakeResponseRow = {
        id: `resp-${rows.length + 1}`,
        interactionId: input.interactionId,
        destinationId: input.destinationId,
        templateId: input.templateId ?? null,
        templateVersion: 1,
        body: input.body ?? null,
        status: input.status ?? 'DRAFT',
        scheduledAt: null,
        respondedAt: null,
        externalResponseId: null,
        createdAt: now,
        updatedAt: now,
      };
      rows.push(row);
      return row;
    },
  } as unknown as InteractionResponsesRepository;

  const outbox = {
    async enqueue(_tx: unknown, job: { queueName: string; jobId: string }): Promise<void> {
      enqueued.push({ queueName: job.queueName, jobId: job.jobId });
    },
  } as unknown as OutboxRepository;

  state.repo = repo;
  state.outbox = outbox;
  return state;
}

function interaction(overrides: Partial<InteractionSnapshot> = {}): InteractionSnapshot {
  return {
    id: 'int-1',
    destinationId: 'dest-1',
    interactionType: 'COMMENT',
    externalInteractionId: 'ext-1',
    actorExternalId: 'actor-1',
    actorDisplayName: 'Alice',
    content: 'thanks, great post!',
    parentExternalId: null,
    publicationId: null,
    ...overrides,
  };
}

function destination(): DestinationSnapshot {
  return { id: 'dest-1', name: 'Content Platform', trustLevel: 'HIGH' };
}

function config(): InteractionResponseConfig {
  return { rules: [], maxResponsesPerHour: 20, minIntervalSeconds: 30 };
}

const templates: TemplateMap = {
  'thanks-template': 'Hi {{actor_display_name}}, thanks for your comment!',
  generic: 'Hello {{actor_display_name}}!',
};

describe('InteractionResponseService.decide', () => {
  it('returns IGNORED for reactions', async () => {
    const env = makeEnv();
    const service = new InteractionResponseService({
      txManager: makeTxManager(),
      responsesRepo: env.repo,
      outboxRepo: env.outbox,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const outcome = await service.decide({
      interaction: interaction({ interactionType: 'REACTION' }),
      destination: destination(),
      publication: null,
      config: config(),
      templates,
    });
    expect(outcome.kind).toBe('IGNORED');
    expect(env.enqueued).toEqual([]);
  });

  it('returns NOTIFICATION_ONLY for mentions', async () => {
    const env = makeEnv();
    const service = new InteractionResponseService({
      txManager: makeTxManager(),
      responsesRepo: env.repo,
      outboxRepo: env.outbox,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const outcome = await service.decide({
      interaction: interaction({ interactionType: 'MENTION' }),
      destination: destination(),
      publication: null,
      config: config(),
      templates,
    });
    expect(outcome.kind).toBe('NOTIFICATION_ONLY');
    expect(env.enqueued).toEqual([]);
  });

  it('creates a MODERATION_REQUIRED row when no rule matches (no outbox job)', async () => {
    const env = makeEnv();
    const service = new InteractionResponseService({
      txManager: makeTxManager(),
      responsesRepo: env.repo,
      outboxRepo: env.outbox,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const outcome = await service.decide({
      interaction: interaction(),
      destination: destination(),
      publication: null,
      config: config(),
      templates,
    });
    expect(outcome.kind).toBe('MODERATION_REQUIRED');
    expect(env.rows).toHaveLength(1);
    expect(env.rows[0]!.status).toBe('MODERATION_REQUIRED');
    expect(env.enqueued).toEqual([]);
  });

  it('creates an AUTO_RESPOND row and enqueues a webhook.respond job', async () => {
    const env = makeEnv();
    const service = new InteractionResponseService({
      txManager: makeTxManager(),
      responsesRepo: env.repo,
      outboxRepo: env.outbox,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const outcome = await service.decide({
      interaction: interaction(),
      destination: destination(),
      publication: null,
      config: {
        rules: [
          {
            id: 'thanks',
            priority: 1,
            action: 'AUTO_RESPOND',
            templateId: 'thanks-template',
            match: { keywords: ['thanks'] },
          },
        ],
        maxResponsesPerHour: 20,
        minIntervalSeconds: 30,
      },
      templates,
    });
    expect(outcome.kind).toBe('AUTO_RESPOND');
    if (outcome.kind === 'AUTO_RESPOND') {
      expect(outcome.templateId).toBe('thanks-template');
      expect(outcome.body).toBe('Hi Alice, thanks for your comment!');
    }
    expect(env.rows).toHaveLength(1);
    expect(env.rows[0]!.status).toBe('AUTO_RESPOND');
    expect(env.rows[0]!.body).toBe('Hi Alice, thanks for your comment!');
    expect(env.enqueued).toHaveLength(1);
    expect(env.enqueued[0]!.queueName).toBe('webhook.respond');
    expect(env.enqueued[0]!.jobId).toBe('webhook.respond:resp-1');
  });

  it('defers to moderation when the template has a missing placeholder', async () => {
    const env = makeEnv();
    const service = new InteractionResponseService({
      txManager: makeTxManager(),
      responsesRepo: env.repo,
      outboxRepo: env.outbox,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const outcome = await service.decide({
      interaction: interaction({ actorDisplayName: null }),
      destination: destination(),
      publication: null,
      config: {
        rules: [
          {
            id: 'thanks',
            priority: 1,
            action: 'AUTO_RESPOND',
            templateId: 'thanks-template',
            match: { keywords: ['thanks'] },
          },
        ],
        maxResponsesPerHour: 20,
        minIntervalSeconds: 30,
      },
      templates,
    });
    expect(outcome.kind).toBe('MODERATION_REQUIRED');
    expect(env.rows).toHaveLength(1);
    expect(env.rows[0]!.status).toBe('MODERATION_REQUIRED');
    expect(env.enqueued).toEqual([]);
  });

  it('defers to moderation when the template is missing from the map', async () => {
    const env = makeEnv();
    const service = new InteractionResponseService({
      txManager: makeTxManager(),
      responsesRepo: env.repo,
      outboxRepo: env.outbox,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const outcome = await service.decide({
      interaction: interaction(),
      destination: destination(),
      publication: null,
      config: {
        rules: [
          {
            id: 'thanks',
            priority: 1,
            action: 'AUTO_RESPOND',
            templateId: 'missing-template',
            match: { keywords: ['thanks'] },
          },
        ],
        maxResponsesPerHour: 20,
        minIntervalSeconds: 30,
      },
      templates,
    });
    expect(outcome.kind).toBe('MODERATION_REQUIRED');
    expect(env.rows).toHaveLength(1);
    expect(env.enqueued).toEqual([]);
  });

  it('is idempotent: second decide call reuses the existing response', async () => {
    const env = makeEnv();
    const service = new InteractionResponseService({
      txManager: makeTxManager(),
      responsesRepo: env.repo,
      outboxRepo: env.outbox,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const args = {
      interaction: interaction(),
      destination: destination(),
      publication: null,
      config: config(),
      templates,
    };
    const first = await service.decide(args);
    const second = await service.decide(args);
    expect(first.kind).toBe('MODERATION_REQUIRED');
    expect(second.kind).toBe('MODERATION_REQUIRED');
    if (first.kind === 'MODERATION_REQUIRED' && second.kind === 'MODERATION_REQUIRED') {
      expect(second.responseId).toBe(first.responseId);
    }
    expect(env.rows).toHaveLength(1);
    expect(env.enqueued).toEqual([]);
  });

  it('produces a deterministic requestPayloadHash', () => {
    const env = makeEnv();
    const service = new InteractionResponseService({
      txManager: makeTxManager(),
      responsesRepo: env.repo,
      outboxRepo: env.outbox,
    });
    const h1 = service.requestPayloadHash('hello');
    const h2 = service.requestPayloadHash('hello');
    const h3 = service.requestPayloadHash('world');
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
