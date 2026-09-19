import { describe, expect, it, vi } from 'vitest';
import { MetaInteractionAdapter } from './meta-interaction-adapter.js';
import type {
  GraphClient,
  GraphPostInput,
  GraphPostResult,
  MetaRateLimiter,
  RateLimitDecision,
  ReplyInput,
} from './meta-types.js';

const HASH = 'sha256:deadbeef';

function baseInput(overrides: Partial<ReplyInput> = {}): ReplyInput {
  return {
    destinationId: 'dest-1',
    commentId: 'comment-1',
    body: 'Hello!',
    requestPayloadHash: HASH,
    ...overrides,
  };
}

interface Stub {
  graphClient: GraphClient;
  rateLimiter: MetaRateLimiter;
  getAccessToken: (destinationId: string) => Promise<string>;
  graphPostCalls: GraphPostInput[];
}

function stub(options: {
  rateLimit?: RateLimitDecision;
  graphResult?: GraphPostResult | Error;
  accessToken?: string | Error;
}): Stub {
  const graphPostCalls: GraphPostInput[] = [];
  const graphClient: GraphClient = {
    async post(input) {
      graphPostCalls.push(input);
      const r = options.graphResult;
      if (r === undefined) throw new Error('no graphResult configured');
      if (r instanceof Error) throw r;
      return r;
    },
  };
  const rateLimiter: MetaRateLimiter = {
    async checkEngagement() {
      return options.rateLimit ?? { allowed: true };
    },
  };
  const getAccessToken = async (_destinationId: string) => {
    const t = options.accessToken;
    if (t === undefined) return 'token-abc';
    if (t instanceof Error) throw t;
    return t;
  };
  return { graphClient, rateLimiter, getAccessToken, graphPostCalls };
}

function build(s: Stub): MetaInteractionAdapter {
  return new MetaInteractionAdapter(
    {
      graphClient: s.graphClient,
      rateLimiter: s.rateLimiter,
      getAccessToken: s.getAccessToken,
    },
    { apiVersion: 'v21.0' },
  );
}

describe('MetaInteractionAdapter', () => {
  it('returns SUCCESS on a successful graph call', async () => {
    const s = stub({
      graphResult: { ok: true, data: { id: 'reply-123' } },
    });
    const adapter = build(s);
    const result = await adapter.replyToComment(baseInput());
    expect(result.status).toBe('SUCCESS');
    if (result.status === 'SUCCESS') {
      expect(result.externalResponseId).toBe('reply-123');
      expect(result.requestPayloadHash).toBe(HASH);
    }
  });

  it('calls the graph client with the correct path and body', async () => {
    const s = stub({
      graphResult: { ok: true, data: { id: 'x' } },
    });
    const adapter = build(s);
    await adapter.replyToComment(baseInput());
    expect(s.graphPostCalls).toHaveLength(1);
    expect(s.graphPostCalls[0]!.path).toBe('v21.0/comment-1/comments');
    expect(s.graphPostCalls[0]!.body).toEqual({ message: 'Hello!' });
    expect(s.graphPostCalls[0]!.accessToken).toBe('token-abc');
  });

  it('returns RETRY when the rate limiter denies the call', async () => {
    const s = stub({
      rateLimit: { allowed: false, retryAfterSeconds: 42 },
      graphResult: { ok: true, data: { id: 'x' } },
    });
    const adapter = build(s);
    const result = await adapter.replyToComment(baseInput());
    expect(result.status).toBe('RETRY');
    if (result.status === 'RETRY') {
      expect(result.errorCategory).toBe('RATE_LIMIT');
      expect(result.retryAfterSeconds).toBe(42);
    }
    // The graph client must NOT have been called.
    expect(s.graphPostCalls).toHaveLength(0);
  });

  it('returns FAILED with shouldInvalidateCredential when the token lookup fails', async () => {
    const s = stub({
      accessToken: new Error('credential missing'),
      graphResult: { ok: true, data: { id: 'x' } },
    });
    const adapter = build(s);
    const result = await adapter.replyToComment(baseInput());
    expect(result.status).toBe('FAILED');
    if (result.status === 'FAILED') {
      expect(result.errorCategory).toBe('AUTHENTICATION_ERROR');
      expect(result.shouldInvalidateCredential).toBe(true);
    }
    expect(s.graphPostCalls).toHaveLength(0);
  });

  it('maps AUTHENTICATION_ERROR to FAILED with credential invalidation', async () => {
    const s = stub({
      graphResult: {
        ok: false,
        category: 'AUTHENTICATION_ERROR',
        message: 'token expired',
        httpStatus: 401,
      },
    });
    const adapter = build(s);
    const result = await adapter.replyToComment(baseInput());
    expect(result.status).toBe('FAILED');
    if (result.status === 'FAILED') {
      expect(result.shouldInvalidateCredential).toBe(true);
    }
  });

  it('maps AUTHORIZATION_ERROR to FAILED without credential invalidation', async () => {
    const s = stub({
      graphResult: {
        ok: false,
        category: 'AUTHORIZATION_ERROR',
        message: 'not allowed',
        httpStatus: 403,
      },
    });
    const adapter = build(s);
    const result = await adapter.replyToComment(baseInput());
    expect(result.status).toBe('FAILED');
    if (result.status === 'FAILED') {
      expect(result.shouldInvalidateCredential).toBeUndefined();
    }
  });

  it('maps RATE_LIMIT to RETRY with Retry-After', async () => {
    const s = stub({
      graphResult: {
        ok: false,
        category: 'RATE_LIMIT',
        message: 'throttled',
        httpStatus: 429,
        retryAfterSeconds: 120,
      },
    });
    const adapter = build(s);
    const result = await adapter.replyToComment(baseInput());
    expect(result.status).toBe('RETRY');
    if (result.status === 'RETRY') {
      expect(result.retryAfterSeconds).toBe(120);
    }
  });

  it('maps TEMPORARY_SERVER_ERROR to RETRY', async () => {
    const s = stub({
      graphResult: {
        ok: false,
        category: 'TEMPORARY_SERVER_ERROR',
        message: 'gateway error',
        httpStatus: 502,
      },
    });
    const adapter = build(s);
    const result = await adapter.replyToComment(baseInput());
    expect(result.status).toBe('RETRY');
  });

  it('maps INVALID_REQUEST to FAILED', async () => {
    const s = stub({
      graphResult: {
        ok: false,
        category: 'INVALID_REQUEST',
        message: 'bad payload',
        httpStatus: 400,
      },
    });
    const adapter = build(s);
    const result = await adapter.replyToComment(baseInput());
    expect(result.status).toBe('FAILED');
  });

  it('maps CONTENT_REJECTED to FAILED', async () => {
    const s = stub({
      graphResult: {
        ok: false,
        category: 'CONTENT_REJECTED',
        message: 'policy violation',
        httpStatus: 400,
      },
    });
    const adapter = build(s);
    const result = await adapter.replyToComment(baseInput());
    expect(result.status).toBe('FAILED');
    if (result.status === 'FAILED') {
      expect(result.errorCategory).toBe('CONTENT_REJECTED');
    }
  });

  it('maps NETWORK_ERROR to UNKNOWN', async () => {
    const s = stub({
      graphResult: {
        ok: false,
        category: 'NETWORK_ERROR',
        message: 'timeout',
      },
    });
    const adapter = build(s);
    const result = await adapter.replyToComment(baseInput());
    expect(result.status).toBe('UNKNOWN');
  });

  it('maps UNKNOWN to UNKNOWN', async () => {
    const s = stub({
      graphResult: {
        ok: false,
        category: 'UNKNOWN',
        message: 'mystery',
      },
    });
    const adapter = build(s);
    const result = await adapter.replyToComment(baseInput());
    expect(result.status).toBe('UNKNOWN');
  });

  it('returns UNKNOWN when the graph client throws', async () => {
    const s = stub({
      graphResult: new Error('boom'),
    });
    const adapter = build(s);
    const result = await adapter.replyToComment(baseInput());
    expect(result.status).toBe('UNKNOWN');
    if (result.status === 'UNKNOWN') {
      expect(result.errorCategory).toBe('NETWORK_ERROR');
    }
  });

  it('returns UNKNOWN when a success response lacks an id', async () => {
    const s = stub({
      graphResult: { ok: true, data: {} },
    });
    const adapter = build(s);
    const result = await adapter.replyToComment(baseInput());
    expect(result.status).toBe('UNKNOWN');
  });

  it('passes the requestPayloadHash through on all outcomes', async () => {
    const hashes: string[] = [];
    const s = stub({
      graphResult: { ok: true, data: { id: 'x' } },
    });
    const adapter = build(s);
    const r1 = await adapter.replyToComment(baseInput({ requestPayloadHash: 'h1' }));
    hashes.push(r1.requestPayloadHash);
    const s2 = stub({
      graphResult: { ok: false, category: 'RATE_LIMIT', message: 'throttled' },
    });
    const a2 = build(s2);
    const r2 = await a2.replyToComment(baseInput({ requestPayloadHash: 'h2' }));
    hashes.push(r2.requestPayloadHash);
    expect(hashes).toEqual(['h1', 'h2']);
  });
});
