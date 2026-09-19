import { describe, expect, it } from 'vitest';
import { MetaPublisherAdapter } from './meta-publisher-adapter.js';
import type {
  GraphClient,
  GraphPostInput,
  GraphPostResult,
  MetaPublishRateLimiter,
  PostToPageInput,
  RateLimitDecision,
} from './meta-types.js';

const HASH = 'sha256:deadbeef';

function baseInput(overrides: Partial<PostToPageInput> = {}): PostToPageInput {
  return {
    destinationId: 'dest-1',
    pageId: '1287488901121523',
    message: 'Hello from the platform!',
    requestPayloadHash: HASH,
    ...overrides,
  };
}

interface Stub {
  graphClient: GraphClient;
  rateLimiter: MetaPublishRateLimiter;
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
  const rateLimiter: MetaPublishRateLimiter = {
    async checkPublish() {
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

function build(s: Stub): MetaPublisherAdapter {
  return new MetaPublisherAdapter(
    {
      graphClient: s.graphClient,
      rateLimiter: s.rateLimiter,
      getAccessToken: s.getAccessToken,
    },
    { apiVersion: 'v21.0' },
  );
}

describe('MetaPublisherAdapter', () => {
  it('posts a link post via /feed and returns the post id', async () => {
    const s = stub({
      graphResult: { ok: true, data: { id: '1287488901121523_9999' } },
    });
    const adapter = build(s);
    const result = await adapter.postToPage(baseInput({ link: 'https://example.com/article' }));
    expect(result.status).toBe('SUCCESS');
    if (result.status === 'SUCCESS') {
      expect(result.externalPostId).toBe('1287488901121523_9999');
      expect(result.requestPayloadHash).toBe(HASH);
    }
    expect(s.graphPostCalls).toHaveLength(1);
    expect(s.graphPostCalls[0]!.path).toBe('v21.0/1287488901121523/feed');
    expect(s.graphPostCalls[0]!.body).toEqual({
      message: 'Hello from the platform!',
      link: 'https://example.com/article',
    });
  });

  it('posts a text-only post when no link and no image', async () => {
    const s = stub({
      graphResult: { ok: true, data: { id: '1287488901121523_1000' } },
    });
    const adapter = build(s);
    const result = await adapter.postToPage(baseInput());
    expect(result.status).toBe('SUCCESS');
    if (result.status === 'SUCCESS') {
      expect(result.externalPostId).toBe('1287488901121523_1000');
    }
    expect(s.graphPostCalls[0]!.path).toBe('v21.0/1287488901121523/feed');
    expect(s.graphPostCalls[0]!.body).toEqual({
      message: 'Hello from the platform!',
    });
  });

  it('posts a photo post via /photos and prefers post_id over id', async () => {
    const s = stub({
      graphResult: {
        ok: true,
        data: { id: 'photo-id-123', post_id: '1287488901121523_1001' },
      },
    });
    const adapter = build(s);
    const result = await adapter.postToPage(
      baseInput({
        imageUrl: 'https://example.com/image.jpg',
        link: 'https://example.com/article',
      }),
    );
    expect(result.status).toBe('SUCCESS');
    if (result.status === 'SUCCESS') {
      expect(result.externalPostId).toBe('1287488901121523_1001');
    }
    expect(s.graphPostCalls[0]!.path).toBe('v21.0/1287488901121523/photos');
    expect(s.graphPostCalls[0]!.body).toEqual({
      url: 'https://example.com/image.jpg',
      caption: 'Hello from the platform!',
    });
  });

  it('falls back to photo id when post_id is missing', async () => {
    const s = stub({
      graphResult: { ok: true, data: { id: 'photo-id-123' } },
    });
    const adapter = build(s);
    const result = await adapter.postToPage(
      baseInput({ imageUrl: 'https://example.com/image.jpg' }),
    );
    expect(result.status).toBe('SUCCESS');
    if (result.status === 'SUCCESS') {
      expect(result.externalPostId).toBe('photo-id-123');
    }
  });

  it('returns RETRY when the rate limiter denies the call', async () => {
    const s = stub({
      rateLimit: { allowed: false, retryAfterSeconds: 60 },
      graphResult: { ok: true, data: { id: 'x' } },
    });
    const adapter = build(s);
    const result = await adapter.postToPage(baseInput());
    expect(result.status).toBe('RETRY');
    if (result.status === 'RETRY') {
      expect(result.errorCategory).toBe('RATE_LIMIT');
      expect(result.retryAfterSeconds).toBe(60);
    }
    expect(s.graphPostCalls).toHaveLength(0);
  });

  it('returns FAILED with shouldInvalidateCredential when token lookup fails', async () => {
    const s = stub({
      accessToken: new Error('credential missing'),
      graphResult: { ok: true, data: { id: 'x' } },
    });
    const adapter = build(s);
    const result = await adapter.postToPage(baseInput());
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
    const result = await adapter.postToPage(baseInput());
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
    const result = await adapter.postToPage(baseInput());
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
        retryAfterSeconds: 300,
      },
    });
    const adapter = build(s);
    const result = await adapter.postToPage(baseInput());
    expect(result.status).toBe('RETRY');
    if (result.status === 'RETRY') {
      expect(result.retryAfterSeconds).toBe(300);
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
    const result = await adapter.postToPage(baseInput());
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
    const result = await adapter.postToPage(baseInput());
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
    const result = await adapter.postToPage(baseInput());
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
    const result = await adapter.postToPage(baseInput());
    expect(result.status).toBe('UNKNOWN');
  });

  it('returns UNKNOWN when the graph client throws', async () => {
    const s = stub({
      graphResult: new Error('boom'),
    });
    const adapter = build(s);
    const result = await adapter.postToPage(baseInput());
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
    const result = await adapter.postToPage(baseInput());
    expect(result.status).toBe('UNKNOWN');
  });

  it('passes the requestPayloadHash through on all outcomes', async () => {
    const s = stub({
      graphResult: { ok: true, data: { id: 'x' } },
    });
    const adapter = build(s);
    const r1 = await adapter.postToPage(baseInput({ requestPayloadHash: 'h1' }));
    expect(r1.requestPayloadHash).toBe('h1');

    const s2 = stub({
      graphResult: { ok: false, category: 'RATE_LIMIT', message: 'throttled' },
    });
    const a2 = build(s2);
    const r2 = await a2.postToPage(baseInput({ requestPayloadHash: 'h2' }));
    expect(r2.requestPayloadHash).toBe('h2');
  });
});
