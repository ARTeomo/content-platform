import { describe, expect, it, vi } from 'vitest';
import type {
  InteractionResponsesRepository,
  InteractionResponseAttemptsRepository,
  ExternalInteractionsRepository,
  Transaction,
  TransactionManager,
} from '@content-platform/database';
import type { MetaInteractionAdapter, ReplyResult } from '@content-platform/publishers';
import { WebhookRespondService } from './webhook-respond-service.js';

interface FakeResponseRow {
  id: string;
  interactionId: string;
  destinationId: string;
  body: string | null;
  status: string;
  externalResponseId: string | null;
  respondedAt: Date | null;
}

interface FakeInteractionRow {
  id: string;
  externalInteractionId: string;
}

function makeTxManager(): TransactionManager {
  return {
    async run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
      return await fn({} as Transaction);
    },
  } as unknown as TransactionManager;
}

function makeRepos(initial: FakeResponseRow, interactions: FakeInteractionRow[]) {
  const row = { ...initial };
  const responsesRepo = {
    async findById(id: string): Promise<FakeResponseRow | undefined> {
      return id === row.id ? row : undefined;
    },
    async claimForResponding(
      _tx: unknown,
      id: string,
      expected: string[],
    ): Promise<FakeResponseRow | undefined> {
      if (id !== row.id) return undefined;
      if (!expected.includes(row.status)) return undefined;
      row.status = 'IN_PROGRESS';
      return row;
    },
    async markResponded(
      _tx: unknown,
      id: string,
      externalResponseId: string,
      respondedAt: Date,
    ): Promise<void> {
      if (id !== row.id) return;
      row.status = 'RESPONDED';
      row.externalResponseId = externalResponseId;
      row.respondedAt = respondedAt;
    },
    async markFailed(_tx: unknown, id: string): Promise<void> {
      if (id !== row.id) return;
      row.status = 'FAILED';
    },
    async markUnknown(_tx: unknown, id: string): Promise<void> {
      if (id !== row.id) return;
      row.status = 'UNKNOWN';
    },
    async markRetry(_tx: unknown, id: string): Promise<void> {
      if (id !== row.id) return;
      row.status = 'RETRY';
    },
  } as unknown as InteractionResponsesRepository;

  const attempts: { id: string; status: string }[] = [];
  const attemptsRepo = {
    async startAttempt(
      _tx: unknown,
      _responseId: string,
      _hash: string,
    ): Promise<{ id: string; status: string }> {
      const a = { id: `att-${attempts.length + 1}`, status: 'PENDING' };
      attempts.push(a);
      return a;
    },
    async finishSuccess(_tx: unknown, attemptId: string): Promise<void> {
      const a = attempts.find((x) => x.id === attemptId);
      if (a) a.status = 'SUCCESS';
    },
    async finishFailure(_tx: unknown, attemptId: string, _at: Date, status: string): Promise<void> {
      const a = attempts.find((x) => x.id === attemptId);
      if (a) a.status = status;
    },
  } as unknown as InteractionResponseAttemptsRepository;

  const interactionsRepo = {
    async findById(id: string): Promise<FakeInteractionRow | undefined> {
      return interactions.find((i) => i.id === id);
    },
  } as unknown as ExternalInteractionsRepository;

  return { responsesRepo, attemptsRepo, interactionsRepo, row, attempts };
}

function makeAdapter(result: ReplyResult): MetaInteractionAdapter {
  return {
    async replyToComment() {
      return result;
    },
  } as unknown as MetaInteractionAdapter;
}

function baseRow(overrides: Partial<FakeResponseRow> = {}): FakeResponseRow {
  return {
    id: 'resp-1',
    interactionId: 'int-1',
    destinationId: 'dest-1',
    body: 'Hello!',
    status: 'AUTO_RESPOND',
    externalResponseId: null,
    respondedAt: null,
    ...overrides,
  };
}

function build(args: {
  row?: Partial<FakeResponseRow>;
  interactions?: FakeInteractionRow[];
  result: ReplyResult;
}) {
  const interactions = args.interactions ?? [
    { id: 'int-1', externalInteractionId: 'meta-comment-1' },
  ];
  const repos = makeRepos(baseRow(args.row), interactions);
  const adapter = makeAdapter(args.result);
  const service = new WebhookRespondService({
    txManager: makeTxManager(),
    responsesRepo: repos.responsesRepo,
    attemptsRepo: repos.attemptsRepo,
    interactionsRepo: repos.interactionsRepo,
    adapter,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  return { service, ...repos };
}

describe('WebhookRespondService', () => {
  it('returns SKIPPED when the response does not exist', async () => {
    const { service } = build({
      result: { status: 'SUCCESS', externalResponseId: 'x', requestPayloadHash: 'h' },
    });
    const outcome = await service.respond('missing');
    expect(outcome.kind).toBe('SKIPPED');
  });

  it('returns SKIPPED when the response is already terminal', async () => {
    const { service } = build({
      row: { status: 'RESPONDED' },
      result: { status: 'SUCCESS', externalResponseId: 'x', requestPayloadHash: 'h' },
    });
    const outcome = await service.respond('resp-1');
    expect(outcome.kind).toBe('SKIPPED');
  });

  it('returns SKIPPED when the body is empty', async () => {
    const { service } = build({
      row: { body: null },
      result: { status: 'SUCCESS', externalResponseId: 'x', requestPayloadHash: 'h' },
    });
    const outcome = await service.respond('resp-1');
    expect(outcome.kind).toBe('SKIPPED');
  });

  it('returns SKIPPED when the interaction is not found', async () => {
    const { service } = build({
      interactions: [],
      result: { status: 'SUCCESS', externalResponseId: 'x', requestPayloadHash: 'h' },
    });
    const outcome = await service.respond('resp-1');
    expect(outcome.kind).toBe('SKIPPED');
    if (outcome.kind === 'SKIPPED') {
      expect(outcome.reason).toContain('interaction');
    }
  });

  it('returns RESPONDED and records the attempt on success', async () => {
    const { service, row, attempts } = build({
      result: {
        status: 'SUCCESS',
        externalResponseId: 'reply-1',
        requestPayloadHash: 'h',
      },
    });
    const outcome = await service.respond('resp-1');
    expect(outcome.kind).toBe('RESPONDED');
    expect(row.status).toBe('RESPONDED');
    expect(row.externalResponseId).toBe('reply-1');
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.status).toBe('SUCCESS');
  });

  it('returns RETRY and moves the response to RETRY on a rate limit', async () => {
    const { service, row, attempts } = build({
      result: {
        status: 'RETRY',
        errorCategory: 'RATE_LIMIT',
        errorMessage: 'throttled',
        retryAfterSeconds: 42,
        requestPayloadHash: 'h',
      },
    });
    const outcome = await service.respond('resp-1');
    expect(outcome.kind).toBe('RETRY');
    if (outcome.kind === 'RETRY') {
      expect(outcome.retryAfterSeconds).toBe(42);
    }
    expect(row.status).toBe('RETRY');
    expect(attempts[0]!.status).toBe('RETRY');
  });

  it('returns FAILED and moves the response to FAILED on a permanent error', async () => {
    const { service, row, attempts } = build({
      result: {
        status: 'FAILED',
        errorCategory: 'CONTENT_REJECTED',
        errorMessage: 'policy',
        requestPayloadHash: 'h',
      },
    });
    const outcome = await service.respond('resp-1');
    expect(outcome.kind).toBe('FAILED');
    expect(row.status).toBe('FAILED');
    expect(attempts[0]!.status).toBe('FAILED');
  });

  it('returns UNKNOWN and moves the response to UNKNOWN on network failure', async () => {
    const { service, row, attempts } = build({
      result: {
        status: 'UNKNOWN',
        errorCategory: 'NETWORK_ERROR',
        errorMessage: 'timeout',
        requestPayloadHash: 'h',
      },
    });
    const outcome = await service.respond('resp-1');
    expect(outcome.kind).toBe('UNKNOWN');
    expect(row.status).toBe('UNKNOWN');
    expect(attempts[0]!.status).toBe('UNKNOWN');
  });

  it('skips when another worker already claimed the response', async () => {
    const { service } = build({
      row: { status: 'IN_PROGRESS' },
      result: { status: 'SUCCESS', externalResponseId: 'x', requestPayloadHash: 'h' },
    });
    const outcome = await service.respond('resp-1');
    expect(outcome.kind).toBe('SKIPPED');
  });
});
