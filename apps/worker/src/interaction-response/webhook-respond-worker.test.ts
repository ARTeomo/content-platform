import { describe, expect, it, vi } from 'vitest';
import { WebhookRespondWorker, WEBHOOK_RESPOND_QUEUE } from './webhook-respond-worker.js';
import type { RespondOutcome, WebhookRespondService } from './webhook-respond-service.js';
import type { WebhookRespondJobData } from './webhook-respond-worker.js';

interface CapturedProcessor {
  queueName: string;
  processor: (job: { id: string | undefined; data: WebhookRespondJobData }) => Promise<void>;
}

interface FakeConsumer {
  close(): Promise<void>;
}

function makeFakeFactory() {
  let captured: CapturedProcessor | undefined;
  let closed = false;
  const factory = (options: {
    queueName: string;
    processor: CapturedProcessor['processor'];
  }): FakeConsumer => {
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

function makeService(outcome: RespondOutcome): WebhookRespondService {
  return {
    async respond() {
      return outcome;
    },
  } as unknown as WebhookRespondService;
}

function build(outcome: RespondOutcome) {
  const fake = makeFakeFactory();
  const service = makeService(outcome);
  const worker = new WebhookRespondWorker({
    consumerFactory: fake.factory,
    service,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  const captured = fake.getCaptured();
  if (!captured) throw new Error('processor was not captured');
  return { worker, captured, fake, service };
}

describe('WebhookRespondWorker', () => {
  it('registers on the webhook.respond queue', () => {
    const { captured } = build({ kind: 'SKIPPED', reason: 'x' });
    expect(captured.queueName).toBe(WEBHOOK_RESPOND_QUEUE);
    expect(captured.queueName).toBe('webhook.respond');
  });

  it('does not throw on SKIPPED', async () => {
    const { captured } = build({ kind: 'SKIPPED', reason: 'terminal' });
    await expect(
      captured.processor({ id: 'job-1', data: { responseId: 'resp-1' } }),
    ).resolves.toBeUndefined();
  });

  it('does not throw on RESPONDED', async () => {
    const { captured } = build({ kind: 'RESPONDED', externalResponseId: 'meta-1' });
    await expect(
      captured.processor({ id: 'job-1', data: { responseId: 'resp-1' } }),
    ).resolves.toBeUndefined();
  });

  it('does not throw on FAILED', async () => {
    const { captured } = build({
      kind: 'FAILED',
      errorCategory: 'CONTENT_REJECTED',
      errorMessage: 'policy',
    });
    await expect(
      captured.processor({ id: 'job-1', data: { responseId: 'resp-1' } }),
    ).resolves.toBeUndefined();
  });

  it('does not throw on UNKNOWN', async () => {
    const { captured } = build({
      kind: 'UNKNOWN',
      errorCategory: 'NETWORK_ERROR',
      errorMessage: 'timeout',
    });
    await expect(
      captured.processor({ id: 'job-1', data: { responseId: 'resp-1' } }),
    ).resolves.toBeUndefined();
  });

  it('throws on RETRY so BullMQ reschedules', async () => {
    const { captured } = build({
      kind: 'RETRY',
      errorCategory: 'RATE_LIMIT',
      errorMessage: 'throttled',
      retryAfterSeconds: 60,
    });
    await expect(
      captured.processor({ id: 'job-1', data: { responseId: 'resp-1' } }),
    ).rejects.toThrow(/retryable/);
  });

  it('passes retryAfterSeconds on the thrown error', async () => {
    const { captured } = build({
      kind: 'RETRY',
      errorCategory: 'RATE_LIMIT',
      errorMessage: 'throttled',
      retryAfterSeconds: 60,
    });
    try {
      await captured.processor({ id: 'job-1', data: { responseId: 'resp-1' } });
      expect.fail('expected throw');
    } catch (err) {
      const e = err as Error & { retryAfterSeconds?: number };
      expect(e.retryAfterSeconds).toBe(60);
    }
  });

  it('skips jobs with an empty responseId without calling the service', async () => {
    const fake = makeFakeFactory();
    let called = false;
    const service = {
      async respond() {
        called = true;
        return { kind: 'SKIPPED', reason: 'unused' } as RespondOutcome;
      },
    } as unknown as WebhookRespondService;
    new WebhookRespondWorker({
      consumerFactory: fake.factory,
      service,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const captured = fake.getCaptured();
    if (!captured) throw new Error('processor not captured');
    await captured.processor({ id: 'job-empty', data: { responseId: '' } });
    expect(called).toBe(false);
  });

  it('delegates close to the consumer', async () => {
    const { worker, fake } = build({ kind: 'SKIPPED', reason: 'x' });
    await worker.close();
    expect(fake.wasClosed()).toBe(true);
  });
});
