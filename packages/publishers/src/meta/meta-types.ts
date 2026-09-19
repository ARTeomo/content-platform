/**
 * Types for the Meta interaction adapter.
 *
 * The adapter is deliberately decoupled from the concrete Graph client
 * and credential service implementations via the GraphClient and
 * getAccessToken function. This keeps the adapter testable in isolation
 * and independent of the authentication package's internal API.
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

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
  remaining?: number;
}

export interface MetaRateLimiter {
  checkEngagement(destinationId: string): Promise<RateLimitDecision>;
}

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
