import { describe, expect, it } from 'vitest';
import { MetaPublicationReconciler } from './meta-publication-reconciler.js';
import type { GraphGetClient, GraphGetInput, GraphGetResult } from './meta-types.js';

function stub(options: { graphResult?: GraphGetResult | Error; accessToken?: string | Error }): {
  graphGetClient: GraphGetClient;
  getAccessToken: (d: string) => Promise<string>;
} {
  const graphGetClient: GraphGetClient = {
    async get(_input: GraphGetInput) {
      const r = options.graphResult;
      if (r === undefined) throw new Error('no graphResult configured');
      if (r instanceof Error) throw r;
      return r;
    },
  };
  const getAccessToken = async (_destinationId: string) => {
    const t = options.accessToken;
    if (t === undefined) return 'token-abc';
    if (t instanceof Error) throw t;
    return t;
  };
  return { graphGetClient, getAccessToken };
}

const OLD_ATTEMPT = new Date(Date.now() - 10 * 60 * 1000);
const RECENT_ATTEMPT = new Date(Date.now() - 5 * 1000);

describe('MetaPublicationReconciler', () => {
  it('returns PUBLISHED when a unique post matches the message', async () => {
    const s = stub({
      graphResult: {
        ok: true,
        data: {
          data: [
            { id: 'other-post', message: 'something else' },
            { id: 'matching-post', message: 'Hello world' },
          ],
        },
      },
    });
    const reconciler = new MetaPublicationReconciler(s);
    const result = await reconciler.pull({
      destinationId: 'dest-1',
      pageId: 'page-1',
      expectedMessage: 'Hello world',
      attemptStartedAt: OLD_ATTEMPT,
    });
    expect(result.status).toBe('PUBLISHED');
    if (result.status === 'PUBLISHED') {
      expect(result.externalPostId).toBe('matching-post');
    }
  });

  it('returns RETRY_ELIGIBLE when no match and attempt is older than the propagation grace', async () => {
    const s = stub({
      graphResult: {
        ok: true,
        data: { data: [{ id: 'p1', message: 'something else' }] },
      },
    });
    const reconciler = new MetaPublicationReconciler(s);
    const result = await reconciler.pull({
      destinationId: 'dest-1',
      pageId: 'page-1',
      expectedMessage: 'Hello world',
      attemptStartedAt: OLD_ATTEMPT,
    });
    expect(result.status).toBe('RETRY_ELIGIBLE');
  });

  it('returns UNKNOWN when no match but the attempt is inside the propagation grace', async () => {
    const s = stub({
      graphResult: { ok: true, data: { data: [] } },
    });
    const reconciler = new MetaPublicationReconciler(s);
    const result = await reconciler.pull({
      destinationId: 'dest-1',
      pageId: 'page-1',
      expectedMessage: 'Hello world',
      attemptStartedAt: RECENT_ATTEMPT,
    });
    expect(result.status).toBe('UNKNOWN');
    if (result.status === 'UNKNOWN') {
      expect(result.reason).toContain('below propagation grace');
    }
  });

  it('returns UNKNOWN when multiple posts match the message', async () => {
    const s = stub({
      graphResult: {
        ok: true,
        data: {
          data: [
            { id: 'p1', message: 'dup' },
            { id: 'p2', message: 'dup' },
          ],
        },
      },
    });
    const reconciler = new MetaPublicationReconciler(s);
    const result = await reconciler.pull({
      destinationId: 'dest-1',
      pageId: 'page-1',
      expectedMessage: 'dup',
      attemptStartedAt: OLD_ATTEMPT,
    });
    expect(result.status).toBe('UNKNOWN');
    if (result.status === 'UNKNOWN') {
      expect(result.reason).toContain('ambiguous');
    }
  });

  it('returns UNKNOWN when the matched post has no id', async () => {
    const s = stub({
      graphResult: { ok: true, data: { data: [{ message: 'Hello world' }] } },
    });
    const reconciler = new MetaPublicationReconciler(s);
    const result = await reconciler.pull({
      destinationId: 'dest-1',
      pageId: 'page-1',
      expectedMessage: 'Hello world',
      attemptStartedAt: OLD_ATTEMPT,
    });
    expect(result.status).toBe('UNKNOWN');
    if (result.status === 'UNKNOWN') {
      expect(result.reason).toContain('no id');
    }
  });

  it('returns UNKNOWN when getAccessToken throws', async () => {
    const s = stub({
      accessToken: new Error('credential missing'),
      graphResult: { ok: true, data: { data: [] } },
    });
    const reconciler = new MetaPublicationReconciler(s);
    const result = await reconciler.pull({
      destinationId: 'dest-1',
      pageId: 'page-1',
      expectedMessage: 'Hello world',
      attemptStartedAt: OLD_ATTEMPT,
    });
    expect(result.status).toBe('UNKNOWN');
    if (result.status === 'UNKNOWN') {
      expect(result.reason).toContain('credential lookup failed');
    }
  });

  it('returns UNKNOWN when the graph client throws', async () => {
    const s = stub({
      graphResult: new Error('boom'),
    });
    const reconciler = new MetaPublicationReconciler(s);
    const result = await reconciler.pull({
      destinationId: 'dest-1',
      pageId: 'page-1',
      expectedMessage: 'Hello world',
      attemptStartedAt: OLD_ATTEMPT,
    });
    expect(result.status).toBe('UNKNOWN');
    if (result.status === 'UNKNOWN') {
      expect(result.reason).toContain('graph client threw');
    }
  });

  it('returns UNKNOWN when the graph response is not ok', async () => {
    const s = stub({
      graphResult: {
        ok: false,
        category: 'RATE_LIMIT',
        message: 'throttled',
        httpStatus: 429,
      },
    });
    const reconciler = new MetaPublicationReconciler(s);
    const result = await reconciler.pull({
      destinationId: 'dest-1',
      pageId: 'page-1',
      expectedMessage: 'Hello world',
      attemptStartedAt: OLD_ATTEMPT,
    });
    expect(result.status).toBe('UNKNOWN');
    if (result.status === 'UNKNOWN') {
      expect(result.reason).toContain('RATE_LIMIT');
    }
  });

  it('returns UNKNOWN when the feed data is not an array', async () => {
    const s = stub({
      graphResult: { ok: true, data: { data: null } },
    });
    const reconciler = new MetaPublicationReconciler(s);
    const result = await reconciler.pull({
      destinationId: 'dest-1',
      pageId: 'page-1',
      expectedMessage: 'Hello world',
      attemptStartedAt: OLD_ATTEMPT,
    });
    expect(result.status).toBe('RETRY_ELIGIBLE');
  });

  it('honours a custom propagation grace period', async () => {
    const s = stub({
      graphResult: { ok: true, data: { data: [] } },
    });
    const reconciler = new MetaPublicationReconciler(s);
    const attemptAt = new Date(Date.now() - 30 * 1000);
    const result = await reconciler.pull({
      destinationId: 'dest-1',
      pageId: 'page-1',
      expectedMessage: 'Hello world',
      attemptStartedAt: attemptAt,
      propagationGraceSeconds: 120,
    });
    expect(result.status).toBe('UNKNOWN');
  });
});
