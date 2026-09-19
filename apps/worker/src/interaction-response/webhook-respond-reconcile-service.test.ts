import { describe, expect, it, vi } from 'vitest';
import type {
  ExternalInteractionsRepository,
  InteractionResponsesRepository,
  InteractionResponseReconciliationsRepository,
  OutboxRepository,
  Transaction,
  TransactionManager,
} from '@content-platform/database';
import type { MetaResponseReconciler, ReconcilePullResult } from '@content-platform/publishers';
import { WebhookRespondReconcileService } from './webhook-respond-reconcile-service.js';

interface FakeResponseRow {
  id: string;
  interactionId: string;
  destinationId: string;
  body: string | null;
  status: string;
  externalResponseId: string | null;
  respondedAt: Date | null;
}

function makeTxManager(): TransactionManager {
  return {
    async run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
      return await fn({} as Transaction);
    },
  } as unknown as TransactionManager;
}

interface Harness {
  service: WebhookRespondReconcileService;
  row: FakeResponseRow;
  reconciliations: { status: string }[];
  enqueued: { queueName: string; jobId: string }[];
}

function build(args: {
  row?: Partial<FakeResponseRow>;
  interactionExists?: boolean;
  pullResult: ReconcilePullResult;
  reconcileCount?: number;
}): Harness {
  const row: FakeResponseRow = {
    id: 'resp-1',
    interactionId: 'int-1',
    destinationId: 'dest-1',
    body: 'Hello!',
    status: 'UNKNOWN',
    externalResponseId: null,
    respondedAt: null,
    ...args.row,
  };

  const reconciliations: { status: string }[] = [];
  const enqueued: { queueName: string; jobId: string }[] = [];
  const count = args.reconcileCount ?? 0;

  const responsesRepo = {
    async findById(id: string): Promise<FakeResponseRow | undefined> {
      return id === row.id ? row : undefined;
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
    async markRetry(_tx: unknown, id: string): Promise<void> {
      if (id !== row.id) return;
      row.status = 'RETRY';
    },
  } as unknown as InteractionResponsesRepository;

  const reconciliationsRepo = {
    async record(_tx: unknown, input: { status: string }): Promise<{ id: string }> {
      reconciliations.push({ status: input.status });
      return { id: `recon-${reconciliations.length}` };
    },
    async countForResponse(_responseId: string): Promise<number> {
      return count;
    },
  } as unknown as InteractionResponseReconciliationsRepository;

  const interactionsRepo = {
    async findById(id: string): Promise<{ id: string; externalInteractionId: string } | undefined> {
      if (args.interactionExists === false) return undefined;
      return id === 'int-1' ? { id: 'int-1', externalInteractionId: 'meta-c-1' } : undefined;
    },
  } as unknown as ExternalInteractionsRepository;

  const outboxRepo = {
    async enqueue(_tx: unknown, job: { queueName: string; jobId: string }): Promise<void> {
      enqueued.push({ queueName: job.queueName, jobId: job.jobId });
    },
  } as unknown as OutboxRepository;

  const reconciler = {
    async pull() {
      return args.pullResult;
    },
  } as unknown as MetaResponseReconciler;

  const service = new WebhookRespondReconcileService({
    txManager: makeTxManager(),
    responsesRepo,
    reconciliationsRepo,
    interactionsRepo,
    outboxRepo,
    reconciler,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });

  return { service, row, reconciliations, enqueued };
}

describe('WebhookRespondReconcileService', () => {
  it('returns SKIPPED when the response does not exist', async () => {
    const { service } = build({
      pullResult: { status: 'RETRY_ELIGIBLE' },
    });
    const outcome = await service.reconcile('missing');
    expect(outcome.kind).toBe('SKIPPED');
  });

  it('returns SKIPPED when the status is not reconcile-eligible', async () => {
    const { service } = build({
      row: { status: 'RESPONDED' },
      pullResult: { status: 'RETRY_ELIGIBLE' },
    });
    const outcome = await service.reconcile('resp-1');
    expect(outcome.kind).toBe('SKIPPED');
  });

  it('returns SKIPPED when the body is empty', async () => {
    const { service } = build({
      row: { body: null },
      pullResult: { status: 'RETRY_ELIGIBLE' },
    });
    const outcome = await service.reconcile('resp-1');
    expect(outcome.kind).toBe('SKIPPED');
  });

  it('returns SKIPPED when the interaction is missing', async () => {
    const { service } = build({
      interactionExists: false,
      pullResult: { status: 'RETRY_ELIGIBLE' },
    });
    const outcome = await service.reconcile('resp-1');
    expect(outcome.kind).toBe('SKIPPED');
  });

  it('marks RESPONDED and records the reconciliation on a positive pull', async () => {
    const { service, row, reconciliations } = build({
      pullResult: { status: 'RESPONDED', externalResponseId: 'meta-reply-1' },
    });
    const outcome = await service.reconcile('resp-1');
    expect(outcome.kind).toBe('RESPONDED');
    expect(row.status).toBe('RESPONDED');
    expect(row.externalResponseId).toBe('meta-reply-1');
    expect(reconciliations).toEqual([{ status: 'RESPONDED' }]);
  });

  it('moves to RETRY and enqueues a webhook.respond job on RETRY_ELIGIBLE', async () => {
    const { service, row, reconciliations, enqueued } = build({
      pullResult: { status: 'RETRY_ELIGIBLE' },
      reconcileCount: 3,
    });
    const outcome = await service.reconcile('resp-1');
    expect(outcome.kind).toBe('RETRY_ENQUEUED');
    expect(row.status).toBe('RETRY');
    expect(reconciliations).toEqual([{ status: 'RETRY_ELIGIBLE' }]);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.queueName).toBe('webhook.respond');
    expect(enqueued[0]!.jobId).toBe('webhook.respond:resp-1:reconcile:3');
  });

  it('records an UNKNOWN reconciliation when the pull is still unresolved', async () => {
    const { service, row, reconciliations } = build({
      pullResult: { status: 'UNKNOWN', reason: 'graph rate limit' },
    });
    const outcome = await service.reconcile('resp-1');
    expect(outcome.kind).toBe('STILL_UNKNOWN');
    if (outcome.kind === 'STILL_UNKNOWN') {
      expect(outcome.reason).toBe('graph rate limit');
    }
    // Status is unchanged; only a reconciliation row is added.
    expect(row.status).toBe('UNKNOWN');
    expect(reconciliations).toEqual([{ status: 'UNKNOWN' }]);
  });

  it('uses a different job id after the reconciliation count changes', async () => {
    const a = build({
      pullResult: { status: 'RETRY_ELIGIBLE' },
      reconcileCount: 1,
    });
    await a.service.reconcile('resp-1');
    expect(a.enqueued[0]!.jobId).toBe('webhook.respond:resp-1:reconcile:1');

    const b = build({
      pullResult: { status: 'RETRY_ELIGIBLE' },
      reconcileCount: 2,
    });
    await b.service.reconcile('resp-1');
    expect(b.enqueued[0]!.jobId).toBe('webhook.respond:resp-1:reconcile:2');
  });
});
