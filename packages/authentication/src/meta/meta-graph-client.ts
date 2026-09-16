import { MetaErrorMapper, MetaGraphApiError } from './meta-error-mapper.js';

export interface LongLivedTokenResponse {
  accessToken: string;
  tokenType: string;
  /** Seconds until expiry. */
  expiresIn: number;
}

export interface MetaMeResponse {
  id: string;
  name: string;
}

export interface ExchangeTokenInput {
  shortLivedToken: string;
  appId: string;
  appSecret: string;
}

/**
 * Low-level client for the Meta Graph API.
 *
 * The interface is intentionally small and free of state beyond
 * configuration. The service layer decides which appId / appSecret to use
 * for each call.
 */
export interface MetaGraphClient {
  exchangeForLongLivedToken(input: ExchangeTokenInput): Promise<LongLivedTokenResponse>;
  validateAccessToken(accessToken: string): Promise<MetaMeResponse>;
}

export interface HttpMetaGraphClientOptions {
  /** e.g. `v21.0`. */
  apiVersion: string;
  /** Default `https://graph.facebook.com`. */
  baseUrl?: string;
  /** Request timeout in milliseconds. Default 15_000. */
  timeoutMs?: number;
  /** Override `fetch` for testing. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
}

export class HttpMetaGraphClient implements MetaGraphClient {
  private readonly apiVersion: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpMetaGraphClientOptions) {
    this.apiVersion = options.apiVersion;
    this.baseUrl = options.baseUrl ?? 'https://graph.facebook.com';
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async exchangeForLongLivedToken(input: ExchangeTokenInput): Promise<LongLivedTokenResponse> {
    const url = new URL(`${this.baseUrl}/${this.apiVersion}/oauth/access_token`);
    url.searchParams.set('grant_type', 'fb_exchange_token');
    url.searchParams.set('client_id', input.appId);
    url.searchParams.set('client_secret', input.appSecret);
    url.searchParams.set('fb_exchange_token', input.shortLivedToken);

    const body = await this.request<{
      access_token?: string;
      token_type?: string;
      expires_in?: number;
    }>(url);

    if (!body.access_token || typeof body.expires_in !== 'number') {
      throw new MetaGraphApiError({
        message: 'Long-lived token exchange response is missing access_token or expires_in',
        httpStatus: 200,
        code: 0,
      });
    }

    return {
      accessToken: body.access_token,
      tokenType: body.token_type ?? 'bearer',
      expiresIn: body.expires_in,
    };
  }

  async validateAccessToken(accessToken: string): Promise<MetaMeResponse> {
    const url = new URL(`${this.baseUrl}/${this.apiVersion}/me`);
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('fields', 'id,name');

    const body = await this.request<{ id?: string; name?: string }>(url);

    if (!body.id || typeof body.id !== 'string') {
      throw new MetaGraphApiError({
        message: 'Token validation response did not include an id',
        httpStatus: 200,
        code: 0,
      });
    }

    return { id: body.id, name: body.name ?? '' };
  }

  private async request<T>(url: URL): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url.toString(), {
        method: 'GET',
        signal: controller.signal,
      });

      const text = await response.text();
      let payload: unknown;
      try {
        payload = text.length > 0 ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const parsedError = MetaErrorMapper.parse(payload, response.status);
        if (parsedError) throw parsedError;
        throw new MetaGraphApiError({
          message: `Graph API request failed with HTTP ${response.status}`,
          httpStatus: response.status,
          code: 0,
        });
      }

      if (payload === null) {
        throw new MetaGraphApiError({
          message: 'Graph API response body is empty',
          httpStatus: response.status,
          code: 0,
        });
      }

      return payload as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
