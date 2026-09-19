import type {
  GraphGetClient,
  GraphGetInput,
  GraphGetResult,
  GraphPostClient,
  GraphPostInput,
  GraphPostResult,
  MetaErrorCategory,
} from '@content-platform/publishers';

export interface MetaGraphBridgeOptions {
  apiVersion: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface ExtractedError {
  message: string | undefined;
  code: number | undefined;
  subcode: number | undefined;
}

type ErrorResult = {
  ok: false;
  category: MetaErrorCategory;
  message: string;
  httpStatus?: number;
  retryAfterSeconds?: number;
};

interface RawResponse {
  ok: boolean;
  status: number;
  headers: Headers;
  payload: unknown;
  bodyText: string;
}

/**
 * GraphClient implementation for the publishers package.
 *
 * Talks to the Meta Graph API over HTTPS using Node's global fetch.
 * Encapsulates HTTP, timeout, and error classification. Never throws:
 * every failure is mapped to a result with `ok: false`.
 */
export class MetaGraphBridge implements GraphPostClient, GraphGetClient {
  private readonly apiVersion: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MetaGraphBridgeOptions) {
    this.apiVersion = options.apiVersion;
    this.baseUrl = options.baseUrl ?? 'https://graph.facebook.com';
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async post(input: GraphPostInput): Promise<GraphPostResult> {
    const url = this.buildUrl(input.path, { access_token: input.accessToken });
    const raw = await this.requestRaw({
      method: 'POST',
      url,
      body: input.body,
    });

    if (raw.kind === 'network-error') {
      return { ok: false, category: 'NETWORK_ERROR', message: raw.message };
    }
    if (raw.response.ok) {
      if (
        raw.response.payload &&
        typeof raw.response.payload === 'object' &&
        !Array.isArray(raw.response.payload)
      ) {
        return { ok: true, data: raw.response.payload as Record<string, unknown> };
      }
      return {
        ok: false,
        category: 'UNKNOWN',
        message: 'graph API returned success with no JSON object body',
        httpStatus: raw.response.status,
      };
    }
    return this.classifyError(raw.response);
  }

  async get(input: GraphGetInput): Promise<GraphGetResult> {
    const params: Record<string, string> = { access_token: input.accessToken };
    if (input.params) {
      for (const [k, v] of Object.entries(input.params)) {
        params[k] = v;
      }
    }
    const url = this.buildUrl(input.path, params);
    const raw = await this.requestRaw({ method: 'GET', url });

    if (raw.kind === 'network-error') {
      return { ok: false, category: 'NETWORK_ERROR', message: raw.message };
    }
    if (raw.response.ok) {
      if (
        raw.response.payload &&
        typeof raw.response.payload === 'object' &&
        !Array.isArray(raw.response.payload)
      ) {
        return { ok: true, data: raw.response.payload as Record<string, unknown> };
      }
      return {
        ok: false,
        category: 'UNKNOWN',
        message: 'graph API returned success with no JSON object body',
        httpStatus: raw.response.status,
      };
    }
    return this.classifyError(raw.response);
  }

  private buildUrl(path: string, params: Record<string, string>): URL {
    const fullPath = path.startsWith('v') ? path : `${this.apiVersion}/${path}`;
    const url = new URL(`${this.baseUrl}/${fullPath}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    return url;
  }

  private async requestRaw(args: {
    method: 'GET' | 'POST';
    url: URL;
    body?: unknown;
  }): Promise<{ kind: 'ok'; response: RawResponse } | { kind: 'network-error'; message: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    let bodyText: string;
    try {
      const init: RequestInit = {
        method: args.method,
        signal: controller.signal,
      };
      if (args.body !== undefined) {
        init.headers = { 'content-type': 'application/json' };
        init.body = JSON.stringify(args.body);
      }
      response = await this.fetchImpl(args.url.toString(), init);
      bodyText = await response.text();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { kind: 'network-error', message: `network error: ${message}` };
    } finally {
      clearTimeout(timeout);
    }

    let payload: unknown = null;
    if (bodyText.length > 0) {
      try {
        payload = JSON.parse(bodyText);
      } catch {
        payload = null;
      }
    }

    return {
      kind: 'ok',
      response: {
        ok: response.ok,
        status: response.status,
        headers: response.headers,
        payload,
        bodyText,
      },
    };
  }

  private classifyError(response: RawResponse): ErrorResult {
    const status = response.status;
    const { message, code, subcode } = extractMetaError(response.payload);
    const errorMessage = message ?? `HTTP ${status}: ${response.bodyText.slice(0, 200)}`;

    const retryAfterHeader = response.headers.get('retry-after');
    const parsedRetry = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : NaN;
    const retryAfterSeconds = Number.isFinite(parsedRetry) ? parsedRetry : undefined;

    if (status >= 500 && status < 600) {
      return {
        ok: false,
        category: 'TEMPORARY_SERVER_ERROR',
        message: errorMessage,
        httpStatus: status,
        ...(retryAfterSeconds !== undefined && { retryAfterSeconds }),
      };
    }

    if (status === 429 || code === 4 || code === 32 || code === 613) {
      return {
        ok: false,
        category: 'RATE_LIMIT',
        message: errorMessage,
        httpStatus: status,
        ...(retryAfterSeconds !== undefined && { retryAfterSeconds }),
      };
    }

    if (status === 401 || code === 190) {
      return {
        ok: false,
        category: 'AUTHENTICATION_ERROR',
        message: errorMessage,
        httpStatus: status,
      };
    }

    if (status === 403 || code === 10 || code === 200) {
      return {
        ok: false,
        category: 'AUTHORIZATION_ERROR',
        message: errorMessage,
        httpStatus: status,
      };
    }

    if (status === 400) {
      if (subcode === 1410007 || subcode === 1346003) {
        return {
          ok: false,
          category: 'CONTENT_REJECTED',
          message: errorMessage,
          httpStatus: status,
        };
      }
      return {
        ok: false,
        category: 'INVALID_REQUEST',
        message: errorMessage,
        httpStatus: status,
      };
    }

    return {
      ok: false,
      category: 'UNKNOWN',
      message: errorMessage,
      httpStatus: status,
    };
  }
}

function extractMetaError(payload: unknown): ExtractedError {
  if (!payload || typeof payload !== 'object') {
    return { message: undefined, code: undefined, subcode: undefined };
  }
  const p = payload as Record<string, unknown>;
  const err = p.error;
  if (!err || typeof err !== 'object') {
    return { message: undefined, code: undefined, subcode: undefined };
  }
  const e = err as Record<string, unknown>;
  return {
    message: typeof e.message === 'string' ? e.message : undefined,
    code: typeof e.code === 'number' ? e.code : undefined,
    subcode: typeof e.error_subcode === 'number' ? e.error_subcode : undefined,
  };
}
