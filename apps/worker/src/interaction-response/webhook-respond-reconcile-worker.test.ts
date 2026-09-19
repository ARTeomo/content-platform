import { describe, expect, it, vi } from 'vitest';
import {
  WebhookRespondReconcileWorker,
  WEBHOOK_RESPOND_RECONCILE_QUEUE,
} from './webhook-respond-reconcile-worker.js';
import type {
  ReconcileOutcome,
  WebhookRespondReconcileService,
} from './webhook-respond-reconcile-service.js';
import type { WebhookRespondReconcileJobData } from './webhook-respond-reconcile-worker.js';

interface CapturedProcessor {
  queueName: string;
  processor: (job: {
    id: string | undefined;
    data: WebhookRespondReconcileJobData;
  }) => Promise<void>;
}

function makeFakeFactory() {
  let captured: CapturedProcessor | undefined;
  let closed = false;
  const factory = (options: { queueName: string; processor: CapturedProcessor['processor'] }) => {
    captured = options;
    return {
      async close(): Promise<void> {
        closed = true;
      },
    };
  };
  return {
    factory,
    getCaptured: (): CapturedProcessor | undefined => captured,
    wasClosed: (): boolean => closed,
  };
}

function makeService(outcome: ReconcileOutcome): WebhookRespondReconcileService {
  return {
    async reconcile() {
      return outcome;
    },
  } as unknown as WebhookRespondReconcileService;
}

function build(outcome: ReconcileOutcome) {
  const fake = makeFakeFactory();
  const service = makeService(outcome);
  const worker = new WebhookRespondReconcileWorker({
    consumerFactory: fake.factory,
    service,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  const captured = fake.getCaptured();
  if (!captured) throw new Error('processor not captured');
  return { worker, captured, fake };
}

describe('WebhookRespondReconcileWorker', () => {
  it('registers on the webhook.respond.reconcile queue', () => {
    const { captured } = build({ kind: 'SKIPPED', reason: 'x' });
    expect(captured.queueName).toBe(WEBHOOK_RESPOND_RECONCILE_QUEUE);
    expect(captured.queueName).toBe('webhook.respond.reconcile');
  });

  it('does not throw on SKIPPED', async () => {
    const { captured } = build({ kind: 'SKIPPED', reason: 'x' });
    await expect(
      captured.processor({ id: 'j', data: { responseId: 'resp-1' } }),
    ).resolves.toBeUndefined();
  });

  it('does not throw on RESPONDED', async () => {
    const { captured } = build({ kind: 'RESPONDED', externalResponseId: 'meta-1' });
    await expect(
      captured.processor({ id: 'j', data: { responseId: 'resp-1' } }),
    ).resolves.toBeUndefined();
  });

  it('does not throw on RETRY_ENQUEUED', async () => {
    const { captured } = build({ kind: 'RETRY_ENQUEUED' });
    await expect(
      captured.processor({ id: 'j', data: { responseId: 'resp-1' } }),
    ).resolves.toBeUndefined();
  });

  it('does not throw on STILL_UNKNOWN', async () => {
    const { captured } = build({ kind: 'STILL_UNKNOWN', reason: 'still ambiguous' });
    await expect(
      captured.processor({ id: 'j', data: { responseId: 'resp-1' } }),
    ).resolves.toBeUndefined();
  });

  it('skips jobs with an empty responseId without calling the service', async () => {
    const fake = makeFakeFactory();
    let called = false;
    const service = {
      async reconcile() {
        called = true;
        return { kind: 'SKIPPED', reason: 'unused' } as ReconcileOutcome;
      },
    } as unknown as WebhookRespondReconcileService;
    new WebhookRespondReconcileWorker({
      consumerFactory: fake.factory,
      service,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const captured = fake.getCaptured();
    if (!captured) throw new Error('processor not captured');
    await captured.processor({ id: 'j', data: { responseId: '' } });
    expect(called).toBe(false);
  });

  it('delegates close to the consumer', async () => {
    const { worker, fake } = build({ kind: 'SKIPPED', reason: 'x' });
    await worker.close();
    expect(fake.wasClosed()).toBe(true);
  });
});
