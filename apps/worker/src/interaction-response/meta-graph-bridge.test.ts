import { describe, expect, it } from 'vitest';
import { MetaGraphBridge } from './meta-graph-bridge.js';

interface FetchCall {
  url: string;
  init: RequestInit;
}

interface StubResponse {
  ok: boolean;
  status: number;
  headers: Headers;
  body: string;
}

function jsonHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({ 'content-type': 'application/json', ...extra });
}

function stubFetch(responses: StubResponse[] | (() => StubResponse)): {
  fetchImpl: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  let idx = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init: init ?? {} });
    const r = typeof responses === 'function' ? responses() : responses[idx++];
    if (!r) throw new Error('stubFetch: no response configured');
    return {
      ok: r.ok,
      status: r.status,
      headers: r.headers,
      text: async () => r.body,
    } as Response;
  };
  return { fetchImpl, calls };
}

function build(fetchImpl: typeof fetch): MetaGraphBridge {
  return new MetaGraphBridge({
    apiVersion: 'v21.0',
    fetchImpl,
  });
}

describe('MetaGraphBridge', () => {
  it('returns ok:true with the parsed JSON body on 200', async () => {
    const s = stubFetch([
      { ok: true, status: 200, headers: jsonHeaders(), body: '{"id":"reply-1"}' },
    ]);
    const bridge = build(s.fetchImpl);
    const result = await bridge.post({
      path: 'v21.0/comment-1/comments',
      body: { message: 'hi' },
      accessToken: 'token',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ id: 'reply-1' });
    }
  });

  it('prepends the api version if the caller path does not include it', async () => {
    const s = stubFetch([{ ok: true, status: 200, headers: jsonHeaders(), body: '{"id":"x"}' }]);
    const bridge = build(s.fetchImpl);
    await bridge.post({
      path: 'comment-1/comments',
      body: { message: 'hi' },
      accessToken: 'token',
    });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.url).toContain('/v21.0/comment-1/comments');
  });

  it('sends the body as JSON and the token as a query param', async () => {
    const s = stubFetch([{ ok: true, status: 200, headers: jsonHeaders(), body: '{"id":"x"}' }]);
    const bridge = build(s.fetchImpl);
    await bridge.post({
      path: 'v21.0/c/comments',
      body: { message: 'hello' },
      accessToken: 'secret-token',
    });
    expect(s.calls[0]!.init.method).toBe('POST');
    expect(s.calls[0]!.init.body).toBe('{"message":"hello"}');
    expect(s.calls[0]!.url).toContain('access_token=secret-token');
  });

  it('maps 500 to TEMPORARY_SERVER_ERROR', async () => {
    const s = stubFetch([{ ok: false, status: 500, headers: jsonHeaders(), body: '' }]);
    const bridge = build(s.fetchImpl);
    const result = await bridge.post({
      path: 'v21.0/c/comments',
      body: {},
      accessToken: 't',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.category).toBe('TEMPORARY_SERVER_ERROR');
  });

  it('maps 429 to RATE_LIMIT with Retry-After', async () => {
    const s = stubFetch([
      {
        ok: false,
        status: 429,
        headers: jsonHeaders({ 'retry-after': '120' }),
        body: '',
      },
    ]);
    const bridge = build(s.fetchImpl);
    const result = await bridge.post({
      path: 'v21.0/c/comments',
      body: {},
      accessToken: 't',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.category).toBe('RATE_LIMIT');
      expect(result.retryAfterSeconds).toBe(120);
    }
  });

  it('maps 401 to AUTHENTICATION_ERROR', async () => {
    const s = stubFetch([{ ok: false, status: 401, headers: jsonHeaders(), body: '' }]);
    const bridge = build(s.fetchImpl);
    const result = await bridge.post({
      path: 'v21.0/c/comments',
      body: {},
      accessToken: 't',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.category).toBe('AUTHENTICATION_ERROR');
  });

  it('maps Graph error code 190 (OAuth) to AUTHENTICATION_ERROR', async () => {
    const s = stubFetch([
      {
        ok: false,
        status: 400,
        headers: jsonHeaders(),
        body: JSON.stringify({
          error: { message: 'Invalid OAuth token', code: 190, error_subcode: 460 },
        }),
      },
    ]);
    const bridge = build(s.fetchImpl);
    const result = await bridge.post({
      path: 'v21.0/c/comments',
      body: {},
      accessToken: 't',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.category).toBe('AUTHENTICATION_ERROR');
      expect(result.message).toBe('Invalid OAuth token');
    }
  });

  it('maps 403 to AUTHORIZATION_ERROR', async () => {
    const s = stubFetch([{ ok: false, status: 403, headers: jsonHeaders(), body: '' }]);
    const bridge = build(s.fetchImpl);
    const result = await bridge.post({
      path: 'v21.0/c/comments',
      body: {},
      accessToken: 't',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.category).toBe('AUTHORIZATION_ERROR');
  });

  it('maps 400 with content-rejection subcode 1410007 to CONTENT_REJECTED', async () => {
    const s = stubFetch([
      {
        ok: false,
        status: 400,
        headers: jsonHeaders(),
        body: JSON.stringify({
          error: {
            message: 'Content was rejected by automated review',
            code: 368,
            error_subcode: 1410007,
          },
        }),
      },
    ]);
    const bridge = build(s.fetchImpl);
    const result = await bridge.post({
      path: 'v21.0/c/comments',
      body: {},
      accessToken: 't',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.category).toBe('CONTENT_REJECTED');
  });

  it('maps 400 without a content subcode to INVALID_REQUEST', async () => {
    const s = stubFetch([
      { ok: false, status: 400, headers: jsonHeaders(), body: '{"error":{"message":"bad"}}' },
    ]);
    const bridge = build(s.fetchImpl);
    const result = await bridge.post({
      path: 'v21.0/c/comments',
      body: {},
      accessToken: 't',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.category).toBe('INVALID_REQUEST');
  });

  it('maps a fetch throw to NETWORK_ERROR', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('connect ECONNREFUSED');
    };
    const bridge = build(fetchImpl);
    const result = await bridge.post({
      path: 'v21.0/c/comments',
      body: {},
      accessToken: 't',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.category).toBe('NETWORK_ERROR');
      expect(result.message).toContain('ECONNREFUSED');
    }
  });

  it('maps an unparseable success body to UNKNOWN', async () => {
    const s = stubFetch([{ ok: true, status: 200, headers: jsonHeaders(), body: 'not-json' }]);
    const bridge = build(s.fetchImpl);
    const result = await bridge.post({
      path: 'v21.0/c/comments',
      body: {},
      accessToken: 't',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.category).toBe('UNKNOWN');
  });
});
