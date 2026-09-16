/**
 * Meta Graph API error taxonomy.
 *
 * The Graph API returns errors as JSON with an `error` object that
 * includes a numeric `code` and optional `error_subcode`. HTTP status is
 * usually 400 even for authentication errors, so the numeric code is the
 * primary signal.
 *
 * @see https://developers.facebook.com/docs/graph-api/guides/error-handling
 */

export type MetaErrorCategory =
  | 'AUTHENTICATION_ERROR'
  | 'PERMISSION_ERROR'
  | 'RATE_LIMIT'
  | 'TRANSIENT_ERROR'
  | 'VALIDATION_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

/**
 * Error thrown when the Graph API returns an error payload.
 */
export class MetaGraphApiError extends Error {
  readonly httpStatus: number;
  readonly code: number;
  readonly subcode: number | null;
  readonly fbtraceId: string | null;

  constructor(input: {
    message: string;
    httpStatus: number;
    code: number;
    subcode?: number | null;
    fbtraceId?: string | null;
  }) {
    super(input.message);
    this.name = 'MetaGraphApiError';
    this.httpStatus = input.httpStatus;
    this.code = input.code;
    this.subcode = input.subcode ?? null;
    this.fbtraceId = input.fbtraceId ?? null;
  }
}

interface MetaGraphErrorPayload {
  error: {
    message: string;
    type?: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

export class MetaErrorMapper {
  /**
   * Categorize an arbitrary error thrown during a Graph API call.
   */
  static categorize(err: unknown): MetaErrorCategory {
    if (err instanceof MetaGraphApiError) {
      return this.categorizeApiError(err);
    }

    if (err instanceof Error) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (
        nodeErr.code === 'ECONNREFUSED' ||
        nodeErr.code === 'ETIMEDOUT' ||
        nodeErr.code === 'ENOTFOUND' ||
        nodeErr.code === 'EAI_AGAIN' ||
        nodeErr.code === 'ECONNRESET' ||
        err.name === 'AbortError'
      ) {
        return 'NETWORK_ERROR';
      }
    }

    return 'UNKNOWN_ERROR';
  }

  static categorizeApiError(err: MetaGraphApiError): MetaErrorCategory {
    // Authentication
    if (err.code === 190 || err.code === 102 || err.code === 463 || err.code === 467) {
      return 'AUTHENTICATION_ERROR';
    }
    // Permission
    if (err.code === 10 || err.code === 200 || err.code === 272 || err.code === 803) {
      return 'PERMISSION_ERROR';
    }
    // Rate limiting
    if (err.code === 4 || err.code === 17 || err.code === 32 || err.code === 613) {
      return 'RATE_LIMIT';
    }
    // Transient (Graph API internal errors)
    if (err.code === 1 || err.code === 2 || err.code === 341) {
      return 'TRANSIENT_ERROR';
    }
    // Validation
    if (err.code === 100) {
      return 'VALIDATION_ERROR';
    }

    // HTTP status fallback
    if (err.httpStatus === 401) return 'AUTHENTICATION_ERROR';
    if (err.httpStatus === 403) return 'PERMISSION_ERROR';
    if (err.httpStatus === 429) return 'RATE_LIMIT';
    if (err.httpStatus >= 500) return 'TRANSIENT_ERROR';
    if (err.httpStatus >= 400) return 'VALIDATION_ERROR';

    return 'UNKNOWN_ERROR';
  }

  /**
   * Parse a Graph API error response body.
   *
   * Returns `null` if the body does not match the expected error shape.
   */
  static parse(payload: unknown, httpStatus: number): MetaGraphApiError | null {
    if (!payload || typeof payload !== 'object') return null;
    const p = payload as Partial<MetaGraphErrorPayload>;
    if (!p.error || typeof p.error.code !== 'number' || typeof p.error.message !== 'string') {
      return null;
    }
    return new MetaGraphApiError({
      message: p.error.message,
      httpStatus,
      code: p.error.code,
      subcode: p.error.error_subcode ?? null,
      fbtraceId: p.error.fbtrace_id ?? null,
    });
  }
}
