import type {
  GraphClient,
  MetaErrorCategory,
  MetaPublishRateLimiter,
  PostToPageInput,
  PostToPageResult,
} from './meta-types.js';

export interface MetaPublisherAdapterDeps {
  graphClient: GraphClient;
  rateLimiter: MetaPublishRateLimiter;
  /**
   * Resolves the Page Access Token for the destination. Throws if the
   * credential is missing or invalid; the adapter maps that to a
   * credential-invalidate signal.
   */
  getAccessToken: (destinationId: string) => Promise<string>;
}

export interface MetaPublisherAdapterOptions {
  /** Graph API version prefix, e.g. 'v21.0'. */
  apiVersion: string;
}

/**
 * Adapter for publishing content to a Meta Page feed.
 *
 * Two posting modes:
 *
 *   - **Link post** — `POST /{page-id}/feed` with `{ message, link }`.
 *     Used when no image is provided.
 *
 *   - **Photo post** — `POST /{page-id}/photos` with `{ url, caption }`.
 *     Used when `imageUrl` is provided. Meta returns both `id` (the photo
 *     ID) and `post_id` (the feed post ID). The adapter prefers `post_id`
 *     because that is the identifier that appears in feed webhook events.
 *
 * The adapter classifies all outcomes into four canonical states:
 * SUCCESS, RETRY, FAILED, UNKNOWN. It never throws.
 *
 * The caller is responsible for:
 *   - Persisting the publication attempt record (before and after).
 *   - Invalidating the credential if `shouldInvalidateCredential` is set.
 *   - Scheduling the retry if `status` is RETRY.
 */
export class MetaPublisherAdapter {
  constructor(
    private readonly deps: MetaPublisherAdapterDeps,
    private readonly options: MetaPublisherAdapterOptions,
  ) {}

  async postToPage(input: PostToPageInput): Promise<PostToPageResult> {
    // 1. Rate limit check.
    const limit = await this.deps.rateLimiter.checkPublish(input.destinationId);
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

    // 3. Determine endpoint and body.
    const hasImage = input.imageUrl !== undefined && input.imageUrl.length > 0;

    const path = hasImage
      ? `${this.options.apiVersion}/${input.pageId}/photos`
      : `${this.options.apiVersion}/${input.pageId}/feed`;

    const body: Record<string, unknown> = hasImage
      ? {
          url: input.imageUrl,
          caption: input.message,
        }
      : {
          message: input.message,
          ...(input.link !== undefined && { link: input.link }),
        };

    // 4. Call the Graph API.
    let result;
    try {
      result = await this.deps.graphClient.post({ path, body, accessToken });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: 'UNKNOWN',
        errorCategory: 'NETWORK_ERROR',
        errorMessage: `graph client threw: ${msg}`,
        requestPayloadHash: input.requestPayloadHash,
      };
    }

    // 5. Success path.
    if (result.ok) {
      // Photo posts return both `id` (photo) and `post_id` (feed post).
      // Feed posts return only `id`.
      const externalPostId = hasImage
        ? (extractString(result.data.post_id) ?? extractString(result.data.id))
        : extractString(result.data.id);

      if (!externalPostId) {
        return {
          status: 'UNKNOWN',
          errorCategory: 'UNKNOWN',
          errorMessage: 'graph API returned success without a post id',
          requestPayloadHash: input.requestPayloadHash,
        };
      }
      return {
        status: 'SUCCESS',
        externalPostId,
        requestPayloadHash: input.requestPayloadHash,
      };
    }

    // 6. Error classification.
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
  ): PostToPageResult {
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

function extractString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.length === 0) return undefined;
  return value;
}
