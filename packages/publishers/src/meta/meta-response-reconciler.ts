import type { GraphGetClient } from './meta-types.js';

export interface MetaResponseReconcilerDeps {
  graphGetClient: GraphGetClient;
  /**
   * Resolves the Page Access Token for the destination. Throws if the
   * credential is missing or invalid.
   */
  getAccessToken: (destinationId: string) => Promise<string>;
}

export interface ReconcilePullInput {
  destinationId: string;
  parentCommentId: string;
  expectedBody: string;
}

export type ReconcilePullResult =
  | { status: 'RESPONDED'; externalResponseId: string }
  | { status: 'RETRY_ELIGIBLE' }
  | { status: 'UNKNOWN'; reason: string };

interface GraphReplyRow {
  id?: unknown;
  message?: unknown;
}

/**
 * Pull-based reconciler for uncertain outbound response outcomes.
 *
 * Queries the parent comment's replies and matches them by body text.
 * This is a fallback strategy: the preferred reconciliation path is
 * push, where Meta sends a feed webhook event for the platform's own
 * reply and the `webhook.process` service matches it to the response
 * record.
 *
 * Never throws. Always returns one of three states.
 */
export class MetaResponseReconciler {
  constructor(private readonly deps: MetaResponseReconcilerDeps) {}

  async pull(input: ReconcilePullInput): Promise<ReconcilePullResult> {
    let accessToken: string;
    try {
      accessToken = await this.deps.getAccessToken(input.destinationId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: 'UNKNOWN', reason: `credential lookup failed: ${msg}` };
    }

    let result;
    try {
      result = await this.deps.graphGetClient.get({
        path: `${input.parentCommentId}/comments`,
        params: { fields: 'id,message,from,created_time' },
        accessToken,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: 'UNKNOWN', reason: `graph client threw: ${msg}` };
    }

    if (!result.ok) {
      return {
        status: 'UNKNOWN',
        reason: `graph get failed: ${result.category}: ${result.message}`,
      };
    }

    const rows = extractDataArray(result.data);
    const matches = rows.filter(
      (row) => typeof row.message === 'string' && row.message === input.expectedBody,
    );

    if (matches.length === 0) {
      return { status: 'RETRY_ELIGIBLE' };
    }

    if (matches.length > 1) {
      return {
        status: 'UNKNOWN',
        reason: `ambiguous: ${matches.length} replies match the expected body`,
      };
    }

    const match = matches[0]!;
    if (typeof match.id !== 'string' || match.id.length === 0) {
      return { status: 'UNKNOWN', reason: 'matched reply has no id' };
    }

    return { status: 'RESPONDED', externalResponseId: match.id };
  }
}

function extractDataArray(data: Record<string, unknown>): GraphReplyRow[] {
  const raw = data.data;
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object');
}
