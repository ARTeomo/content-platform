import type {
  GraphClient,
  MetaErrorCategory,
  MetaRateLimiter,
  ReplyInput,
  ReplyResult,
} from './meta-types.js';

export interface MetaInteractionAdapterDeps {
  graphClient: GraphClient;
  rateLimiter: MetaRateLimiter;
  /**
   * Resolves the Page Access Token for the destination. Throws if the
   * credential is missing or invalid; the adapter maps that to a
   * credential-invalidate signal.
   */
  getAccessToken: (destinationId: string) => Promise<string>;
}

export interface MetaInteractionAdapterOptions {
  /** Graph API version prefix, e.g. 'v21.0'. */
  apiVersion: string;
}

/**
 * Adapter for the Meta Graph API interaction response endpoint.
 *
 * The adapter is the boundary between the platform's domain types and
 * the Graph API. It classifies all outcomes into four canonical states:
 * SUCCESS, RETRY, FAILED, UNKNOWN. It never throws.
 *
 * The caller is responsible for:
 *   - Persisting the attempt record (before and after the call).
 *   - Invalidating the credential if `shouldInvalidateCredential` is set.
 *   - Scheduling the retry if `status` is RETRY.
 */
export class MetaInteractionAdapter {
  constructor(
    private readonly deps: MetaInteractionAdapterDeps,
    private readonly options: MetaInteractionAdapterOptions,
  ) {}

  async replyToComment(input: ReplyInput): Promise<ReplyResult> {
    // 1. Rate limit check.
    const limit = await this.deps.rateLimiter.checkEngagement(input.destinationId);
    if (!limit.allowed) {
      return {
        status: 'RETRY',
        errorCategory: 'RATE_LIMIT',
        errorMessage: 'rate limit exceeded',
        ...(limit.retryAfterSeconds !== undefined && {
          retryAfterSeconds: limit.retryAfterSeconds,
        }),
        requestPayloadHash: input.requestPayloadHash,
      };
    }

    // 2. Resolve access token.
    let accessToken: string;
    try {
      accessToken = await this.deps.getAccessToken(input.destinationId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: 'FAILED',
        errorCategory: 'AUTHENTICATION_ERROR',
        errorMessage: `credential lookup failed: ${msg}`,
        shouldInvalidateCredential: true,
        requestPayloadHash: input.requestPayloadHash,
      };
    }

    // 3. Call the Graph API.
    const path = `${this.options.apiVersion}/${input.commentId}/comments`;
    let result;
    try {
      result = await this.deps.graphClient.post({
        path,
        body: { message: input.body },
        accessToken,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: 'UNKNOWN',
        errorCategory: 'NETWORK_ERROR',
        errorMessage: `graph client threw: ${msg}`,
        requestPayloadHash: input.requestPayloadHash,
      };
    }

    // 4. Success path.
    if (result.ok) {
      const id = result.data.id;
      if (typeof id !== 'string' || id.length === 0) {
        return {
          status: 'UNKNOWN',
          errorCategory: 'UNKNOWN',
          errorMessage: 'graph API returned success without a comment id',
          requestPayloadHash: input.requestPayloadHash,
        };
      }
      return {
        status: 'SUCCESS',
        externalResponseId: id,
        requestPayloadHash: input.requestPayloadHash,
      };
    }

    // 5. Error classification.
    return this.classifyError(
      result.category,
      result.message,
      result.retryAfterSeconds,
      input.requestPayloadHash,
    );
  }

  private classifyError(
    category: MetaErrorCategory,
    message: string,
    retryAfterSeconds: number | undefined,
    requestPayloadHash: string,
  ): ReplyResult {
    switch (category) {
      case 'AUTHENTICATION_ERROR':
        return {
          status: 'FAILED',
          errorCategory: 'AUTHENTICATION_ERROR',
          errorMessage: message,
          shouldInvalidateCredential: true,
          requestPayloadHash,
        };

      case 'AUTHORIZATION_ERROR':
      case 'INVALID_REQUEST':
      case 'CONTENT_REJECTED':
        return {
          status: 'FAILED',
          errorCategory: category,
          errorMessage: message,
          requestPayloadHash,
        };

      case 'RATE_LIMIT':
      case 'TEMPORARY_SERVER_ERROR':
        return {
          status: 'RETRY',
          errorCategory: category,
          errorMessage: message,
          ...(retryAfterSeconds !== undefined && { retryAfterSeconds }),
          requestPayloadHash,
        };

      case 'NETWORK_ERROR':
      case 'UNKNOWN':
      default:
        return {
          status: 'UNKNOWN',
          errorCategory: category,
          errorMessage: message,
          requestPayloadHash,
        };
    }
  }
}
