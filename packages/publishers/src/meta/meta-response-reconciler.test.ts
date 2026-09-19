import { describe, expect, it } from 'vitest';
import { MetaResponseReconciler } from './meta-response-reconciler.js';
import type { GraphGetClient, GraphGetInput, GraphGetResult } from './meta-types.js';

function stubGetClient(result: GraphGetResult | Error): {
  client: GraphGetClient;
  calls: GraphGetInput[];
} {
  const calls: GraphGetInput[] = [];
  const client: GraphGetClient = {
    async get(input) {
      calls.push(input);
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { client, calls };
}

function build(args: { result: GraphGetResult | Error; accessToken?: string | Error }): {
  reconciler: MetaResponseReconciler;
  calls: GraphGetInput[];
} {
  const { client, calls } = stubGetClient(args.result);
  const reconciler = new MetaResponseReconciler({
    graphGetClient: client,
    getAccessToken: async () => {
      const t = args.accessToken;
      if (t === undefined) return 'token';
      if (t instanceof Error) throw t;
      return t;
    },
  });
  return { reconciler, calls };
}

describe('MetaResponseReconciler', () => {
  it('returns RESPONDED when exactly one reply matches the body', async () => {
    const { reconciler, calls } = build({
      result: {
        ok: true,
        data: {
          data: [
            { id: 'r1', message: 'other' },
            { id: 'r2', message: 'Hi Alice, thanks!' },
            { id: 'r3', message: 'yet another' },
          ],
        },
      },
    });
    const result = await reconciler.pull({
      destinationId: 'dest-1',
      parentCommentId: 'comment-1',
      expectedBody: 'Hi Alice, thanks!',
    });
    expect(result.status).toBe('RESPONDED');
    if (result.status === 'RESPONDED') {
      expect(result.externalResponseId).toBe('r2');
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe('comment-1/comments');
    expect(calls[0]!.params).toEqual({ fields: 'id,message,from,created_time' });
  });

  it('returns RETRY_ELIGIBLE when no reply matches', async () => {
    const { reconciler } = build({
      result: {
        ok: true,
        data: { data: [{ id: 'r1', message: 'something else' }] },
      },
    });
    const result = await reconciler.pull({
      destinationId: 'dest-1',
      parentCommentId: 'comment-1',
      expectedBody: 'our body',
    });
    expect(result.status).toBe('RETRY_ELIGIBLE');
  });

  it('returns RETRY_ELIGIBLE when there are no replies at all', async () => {
    const { reconciler } = build({
      result: { ok: true, data: { data: [] } },
    });
    const result = await reconciler.pull({
      destinationId: 'dest-1',
      parentCommentId: 'comment-1',
      expectedBody: 'our body',
    });
    expect(result.status).toBe('RETRY_ELIGIBLE');
  });

  it('returns RETRY_ELIGIBLE when the data field is missing', async () => {
    const { reconciler } = build({
      result: { ok: true, data: {} },
    });
    const result = await reconciler.pull({
      destinationId: 'dest-1',
      parentCommentId: 'comment-1',
      expectedBody: 'our body',
    });
    expect(result.status).toBe('RETRY_ELIGIBLE');
  });

  it('returns UNKNOWN on ambiguous matches', async () => {
    const { reconciler } = build({
      result: {
        ok: true,
        data: {
          data: [
            { id: 'r1', message: 'same' },
            { id: 'r2', message: 'same' },
          ],
        },
      },
    });
    const result = await reconciler.pull({
      destinationId: 'dest-1',
      parentCommentId: 'comment-1',
      expectedBody: 'same',
    });
    expect(result.status).toBe('UNKNOWN');
    if (result.status === 'UNKNOWN') {
      expect(result.reason).toContain('ambiguous');
    }
  });

  it('returns UNKNOWN on graph API error', async () => {
    const { reconciler } = build({
      result: {
        ok: false,
        category: 'RATE_LIMIT',
        message: 'throttled',
        httpStatus: 429,
      },
    });
    const result = await reconciler.pull({
      destinationId: 'dest-1',
      parentCommentId: 'comment-1',
      expectedBody: 'body',
    });
    expect(result.status).toBe('UNKNOWN');
    if (result.status === 'UNKNOWN') {
      expect(result.reason).toContain('RATE_LIMIT');
    }
  });

  it('returns UNKNOWN when the graph client throws', async () => {
    const { reconciler } = build({
      result: new Error('network down'),
    });
    const result = await reconciler.pull({
      destinationId: 'dest-1',
      parentCommentId: 'comment-1',
      expectedBody: 'body',
    });
    expect(result.status).toBe('UNKNOWN');
  });

  it('returns UNKNOWN when the access token lookup fails', async () => {
    const { reconciler } = build({
      result: { ok: true, data: { data: [] } },
      accessToken: new Error('no credential'),
    });
    const result = await reconciler.pull({
      destinationId: 'dest-1',
      parentCommentId: 'comment-1',
      expectedBody: 'body',
    });
    expect(result.status).toBe('UNKNOWN');
    if (result.status === 'UNKNOWN') {
      expect(result.reason).toContain('credential');
    }
  });

  it('returns UNKNOWN when the matched reply has no id', async () => {
    const { reconciler } = build({
      result: {
        ok: true,
        data: { data: [{ message: 'body' }] },
      },
    });
    const result = await reconciler.pull({
      destinationId: 'dest-1',
      parentCommentId: 'comment-1',
      expectedBody: 'body',
    });
    expect(result.status).toBe('UNKNOWN');
  });
});
