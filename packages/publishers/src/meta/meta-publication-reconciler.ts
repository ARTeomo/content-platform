import type { GraphGetClient } from './meta-types.js';

export interface MetaPublicationReconcilerDeps {
  graphGetClient: GraphGetClient;
  /**
   * Resolves the Page Access Token for the destination. Throws if the
   * credential is missing or invalid.
   */
  getAccessToken: (destinationId: string) => Promise<string>;
}

export interface ReconcilePublicationInput {
  destinationId: string;
  /** Meta Page ID (destinations.external_id). Not the internal UUID. */
  pageId: string;
  /** The exact message body originally sent for the publication. */
  expectedMessage: string;
  /** When the attempt was started; used to bound the propagation grace period. */
  attemptStartedAt: Date;
  /** Maximum feed entries to inspect. Default: 50. */
  limit?: number;
  /** Propagation grace period in seconds. Default: 60. */
  propagationGraceSeconds?: number;
}

export type ReconcilePublicationResult =
  | { status: 'PUBLISHED'; externalPostId: string }
  | { status: 'RETRY_ELIGIBLE' }
  | { status: 'UNKNOWN'; reason: string };

interface GraphPostRow {
  id?: unknown;
  message?: unknown;
  created_time?: unknown;
}

/**
 * Pull-based reconciler for uncertain outbound publication outcomes.
 *
 * Queries the destination Page's feed and matches posts by message body.
 * This is a fallback strategy: the preferred reconciliation path is
 * push, where Meta sends a feed webhook event for the platform's own
 * post and the `webhook.process` service matches it to the publication
 * record.
 *
 * Never throws. Always returns one of three states.
 */
export class MetaPublicationReconciler {
  constructor(private readonly deps: MetaPublicationReconcilerDeps) {}

  async pull(input: ReconcilePublicationInput): Promise<ReconcilePublicationResult> {
    let accessToken: string;
    try {
      accessToken = await this.deps.getAccessToken(input.destinationId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: 'UNKNOWN', reason: `credential lookup failed: ${msg}` };
    }

    const limit = input.limit ?? 50;

    let result;
    try {
      result = await this.deps.graphGetClient.get({
        path: `${input.pageId}/feed`,
        params: {
          fields: 'id,message,created_time',
          limit: String(limit),
        },
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
      (row) => typeof row.message === 'string' && row.message === input.expectedMessage,
    );

    if (matches.length === 0) {
      const ageMs = Date.now() - input.attemptStartedAt.getTime();
      const graceMs = (input.propagationGraceSeconds ?? 60) * 1000;
      if (ageMs < graceMs) {
        return {
          status: 'UNKNOWN',
          reason: `no matching post yet; attempt is ${Math.round(ageMs / 1000)}s old, below propagation grace`,
        };
      }
      return { status: 'RETRY_ELIGIBLE' };
    }

    if (matches.length > 1) {
      return {
        status: 'UNKNOWN',
        reason: `ambiguous: ${matches.length} posts match the expected message`,
      };
    }

    const match = matches[0]!;
    if (typeof match.id !== 'string' || match.id.length === 0) {
      return { status: 'UNKNOWN', reason: 'matched post has no id' };
    }

    return { status: 'PUBLISHED', externalPostId: match.id };
  }
}

function extractDataArray(data: Record<string, unknown>): GraphPostRow[] {
  const raw = data.data;
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object');
}
