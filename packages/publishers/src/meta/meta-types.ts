/**
 * Types for the Meta adapters (interaction + publisher + reconciler).
 *
 * The adapters are deliberately decoupled from the concrete Graph client
 * and credential service implementations via the GraphClient,
 * GraphGetClient, and getAccessToken interfaces. This keeps the adapters
 * testable in isolation and independent of the authentication package's
 * internal API.
 */

export type MetaErrorCategory =
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'RATE_LIMIT'
  | 'NETWORK_ERROR'
  | 'TEMPORARY_SERVER_ERROR'
  | 'INVALID_REQUEST'
  | 'CONTENT_REJECTED'
  | 'UNKNOWN';

// ---------------------------------------------------------------------------
// Graph client — POST
// ---------------------------------------------------------------------------

export interface GraphPostInput {
  path: string;
  body: Record<string, unknown>;
  accessToken: string;
}

export type GraphPostResult =
  | { ok: true; data: Record<string, unknown> }
  | {
      ok: false;
      category: MetaErrorCategory;
      message: string;
      httpStatus?: number;
      retryAfterSeconds?: number;
    };

export interface GraphClient {
  post(input: GraphPostInput): Promise<GraphPostResult>;
}

/**
 * Backward-compatible alias for GraphClient.
 *
 * Some call sites (e.g. MetaGraphBridge) refer to the POST-only client as
 * `GraphPostClient` to make their intent explicit. Both names refer to the
 * same interface; the alias exists so that neither name needs to be
 * renamed across the codebase.
 */
export type GraphPostClient = GraphClient;

// ---------------------------------------------------------------------------
// Graph client — GET
// ---------------------------------------------------------------------------

export interface GraphGetInput {
  path: string;
  params?: Record<string, string>;
  accessToken: string;
}

export type GraphGetResult =
  | { ok: true; data: Record<string, unknown> }
  | {
      ok: false;
      category: MetaErrorCategory;
      message: string;
      httpStatus?: number;
      retryAfterSeconds?: number;
    };

export interface GraphGetClient {
  get(input: GraphGetInput): Promise<GraphGetResult>;
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
  remaining?: number;
}

/**
 * Rate limiter for interaction responses (pages_manage_engagement BUC).
 */
export interface MetaRateLimiter {
  checkEngagement(destinationId: string): Promise<RateLimitDecision>;
}

/**
 * Rate limiter for publications (pages_manage_posts BUC).
 *
 * Separate from `MetaRateLimiter` because Meta's Business Use Case (BUC)
 * limits for engagement and publishing are independent.
 */
export interface MetaPublishRateLimiter {
  checkPublish(destinationId: string): Promise<RateLimitDecision>;
}

// ---------------------------------------------------------------------------
// Interaction response types
// ---------------------------------------------------------------------------

export interface ReplyInput {
  destinationId: string;
  /** Meta-side comment ID (external_interactions.external_interaction_id). */
  commentId: string;
  body: string;
  /** SHA-256 of the outbound body; stored on the attempt for reconciliation. */
  requestPayloadHash: string;
}

export type ReplyResult =
  | {
      status: 'SUCCESS';
      externalResponseId: string;
      requestPayloadHash: string;
    }
  | {
      status: 'RETRY';
      errorCategory: MetaErrorCategory;
      errorMessage: string;
      retryAfterSeconds?: number;
      requestPayloadHash: string;
    }
  | {
      status: 'FAILED';
      errorCategory: MetaErrorCategory;
      errorMessage: string;
      shouldInvalidateCredential?: boolean;
      requestPayloadHash: string;
    }
  | {
      status: 'UNKNOWN';
      errorCategory: MetaErrorCategory;
      errorMessage: string;
      requestPayloadHash: string;
    };

// ---------------------------------------------------------------------------
// Publisher types
// ---------------------------------------------------------------------------

export interface PostToPageInput {
  destinationId: string;
  /**
   * Meta Page ID (destinations.external_id). Not the internal UUID.
   */
  pageId: string;
  /** Post caption / message body. */
  message: string;
  /**
   * Optional source URL. When set, the post includes a link card. Ignored
   * when `imageUrl` is provided (photo posts do not carry a separate link
   * card in DB v1).
   */
  link?: string;
  /**
   * Optional image URL. When set, the post is created via `/photos` with
   * the caption as the photo caption.
   */
  imageUrl?: string;
  /** SHA-256 of the outbound body; stored on the attempt for reconciliation. */
  requestPayloadHash: string;
}

export type PostToPageResult =
  | {
      status: 'SUCCESS';
      externalPostId: string;
      requestPayloadHash: string;
    }
  | {
      status: 'RETRY';
      errorCategory: MetaErrorCategory;
      errorMessage: string;
      retryAfterSeconds?: number;
      requestPayloadHash: string;
    }
  | {
      status: 'FAILED';
      errorCategory: MetaErrorCategory;
      errorMessage: string;
      shouldInvalidateCredential?: boolean;
      requestPayloadHash: string;
    }
  | {
      status: 'UNKNOWN';
      errorCategory: MetaErrorCategory;
      errorMessage: string;
      requestPayloadHash: string;
    };
