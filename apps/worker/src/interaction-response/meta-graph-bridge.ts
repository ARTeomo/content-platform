import type {
  GraphClient,
  GraphPostInput,
  GraphPostResult,
  MetaErrorCategory,
} from '@content-platform/publishers';

export interface MetaGraphBridgeOptions {
  /** Graph API version, e.g. `v21.0`. */
  apiVersion: string;
  /** Default `https://graph.facebook.com`. */
  baseUrl?: string;
  /** Request timeout in milliseconds. Default 15_000. */
  timeoutMs?: number;
  /** Override fetch for testing. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
}

interface ExtractedError {
  message: string | undefined;
  code: number | undefined;
  subcode: number | undefined;
}

/**
 * GraphClient implementation for the publishers package.
 *
 * Talks to the Meta Graph API over HTTPS using Node's global fetch.
 * Encapsulates HTTP, timeout, and error classification. Never throws:
 * every failure is mapped to a GraphPostResult with `ok: false`.
 *
 * The classification logic below mirrors the Meta error categories
 * used by the publishers package. It is intentionally self-contained so
 * this bridge has no dependency on the authentication package's error
 * mapper (which is focused on the credential-flow endpoints).
 */
export class MetaGraphBridge implements GraphClient {
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
    // If the caller supplies a fully-qualified path (e.g. "v21.0/123/comments"),
    // use it as-is. Otherwise prepend the configured version.
    const path = input.path.startsWith('v') ? input.path : `${this.apiVersion}/${input.path}`;
    const url = new URL(`${this.baseUrl}/${path}`);
    url.searchParams.set('access_token', input.accessToken);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    let bodyText: string;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input.body),
        signal: controller.signal,
      });
      bodyText = await response.text();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        category: 'NETWORK_ERROR',
        message: `network error: ${message}`,
      };
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

    if (response.ok) {
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        return { ok: true, data: payload as Record<string, unknown> };
      }
      return {
        ok: false,
        category: 'UNKNOWN',
        message: 'graph API returned success with no JSON object body',
        httpStatus: response.status,
      };
    }

    return this.classifyError(response, payload, bodyText);
  }

  private classifyError(response: Response, payload: unknown, bodyText: string): GraphPostResult {
    const status = response.status;
    const { message, code, subcode } = extractMetaError(payload);
    const errorMessage = message ?? `HTTP ${status}: ${bodyText.slice(0, 200)}`;

    const retryAfterHeader = response.headers.get('retry-after');
    const parsedRetry = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : NaN;
    const retryAfterSeconds = Number.isFinite(parsedRetry) ? parsedRetry : undefined;

    // 5xx → transient.
    if (status >= 500 && status < 600) {
      return {
        ok: false,
        category: 'TEMPORARY_SERVER_ERROR',
        message: errorMessage,
        httpStatus: status,
        ...(retryAfterSeconds !== undefined && { retryAfterSeconds }),
      };
    }

    // 429 or Graph rate-limit codes (4, 32, 613).
    if (status === 429 || code === 4 || code === 32 || code === 613) {
      return {
        ok: false,
        category: 'RATE_LIMIT',
        message: errorMessage,
        httpStatus: status,
        ...(retryAfterSeconds !== undefined && { retryAfterSeconds }),
      };
    }

    // 401 or Graph OAuth code 190.
    if (status === 401 || code === 190) {
      return {
        ok: false,
        category: 'AUTHENTICATION_ERROR',
        message: errorMessage,
        httpStatus: status,
      };
    }

    // 403 or Graph permission codes (10, 200).
    if (status === 403 || code === 10 || code === 200) {
      return {
        ok: false,
        category: 'AUTHORIZATION_ERROR',
        message: errorMessage,
        httpStatus: status,
      };
    }

    // 400 with a content-rejection subcode.
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _typeCheck: MetaErrorCategory = 'UNKNOWN';
void _typeCheck;
