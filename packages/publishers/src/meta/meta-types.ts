export type MetaErrorCategory =
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'RATE_LIMIT'
  | 'NETWORK_ERROR'
  | 'TEMPORARY_SERVER_ERROR'
  | 'INVALID_REQUEST'
  | 'CONTENT_REJECTED'
  | 'UNKNOWN';

// ---------- POST ----------

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

export interface GraphPostClient {
  post(input: GraphPostInput): Promise<GraphPostResult>;
}

/**
 * Backward-compatible alias. The MetaInteractionAdapter consumes only
 * the POST capability; the alias exists so the adapter's dep name and
 * the existing tests stay stable.
 */
export type GraphClient = GraphPostClient;

// ---------- GET ----------

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

// ---------- Rate limiting ----------

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
  remaining?: number;
}

export interface MetaRateLimiter {
  checkEngagement(destinationId: string): Promise<RateLimitDecision>;
}

// ---------- Reply ----------

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
