import { desc, eq, inArray, sql } from 'drizzle-orm';
import { publicationAttempts } from '../schema/publication/publication-attempts.js';
import type { Database, Transaction } from '../transaction/transaction-manager.js';

type PublicationAttemptRow = typeof publicationAttempts.$inferSelect;

export type PublicationAttemptStatus =
  'PENDING' | 'SUCCESS' | 'RETRY' | 'FAILED' | 'DEAD_LETTER' | 'UNKNOWN';

/**
 * Repository for publication execution attempt history.
 *
 * attempt_number is computed as MAX(existing) + 1 for the publication.
 * The unique constraint on (publication_id, attempt_number) rejects
 * concurrent duplicates.
 */
export class PublicationAttemptsRepository {
  constructor(private readonly db: Database) {}

  async startAttempt(tx: Transaction, publicationId: string): Promise<PublicationAttemptRow> {
    const [row] = await tx
      .insert(publicationAttempts)
      .values({
        publicationId,
        attemptNumber: sql`COALESCE((SELECT MAX(attempt_number) FROM publication_attempts WHERE publication_id = ${publicationId}), 0) + 1`,
        status: 'PENDING',
        startedAt: new Date(),
      })
      .returning();
    if (!row) throw new Error('Failed to start publication attempt');
    return row;
  }

  async finishSuccess(
    tx: Transaction,
    attemptId: string,
    at: Date,
    externalPostId?: string,
  ): Promise<void> {
    await tx
      .update(publicationAttempts)
      .set({
        status: 'SUCCESS',
        finishedAt: at,
        ...(externalPostId !== undefined && { externalPostId }),
      })
      .where(eq(publicationAttempts.id, attemptId));
  }

  async finishFailure(
    tx: Transaction,
    attemptId: string,
    at: Date,
    status: PublicationAttemptStatus,
    errorCategory: string,
    errorMessage: string,
  ): Promise<void> {
    await tx
      .update(publicationAttempts)
      .set({
        status,
        finishedAt: at,
        errorCategory,
        errorMessage,
      })
      .where(eq(publicationAttempts.id, attemptId));
  }

  async findLatestForPublication(
    publicationId: string,
  ): Promise<PublicationAttemptRow | undefined> {
    const [row] = await this.db
      .select()
      .from(publicationAttempts)
      .where(eq(publicationAttempts.publicationId, publicationId))
      .orderBy(desc(publicationAttempts.attemptNumber))
      .limit(1);
    return row;
  }

  async countForPublication(publicationId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(publicationAttempts)
      .where(eq(publicationAttempts.publicationId, publicationId));
    return row?.count ?? 0;
  }

  /**
   * Batch max-attempt lookup for a set of publication IDs (GROUP BY,
   * one round trip). Publications with no attempts are omitted; callers
   * treating absence as 0 must default explicitly.
   */
  async findMaxAttemptsByIds(
    tx: Transaction,
    ids: readonly string[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (ids.length === 0) return result;
    const rows = await tx
      .select({
        publicationId: publicationAttempts.publicationId,
        maxAttempt: sql<number>`MAX(${publicationAttempts.attemptNumber})::int`,
      })
      .from(publicationAttempts)
      .where(inArray(publicationAttempts.publicationId, [...ids]))
      .groupBy(publicationAttempts.publicationId);
    for (const row of rows) {
      result.set(row.publicationId, row.maxAttempt);
    }
    return result;
  }

  /**
   * In-transaction max-attempt read for a single publication
   * (`COALESCE(MAX(attempt_number), 0)`; 0 for anomalous attempt-less
   * rows). While a publication stays in `RETRY` no new attempt can start
   * (`claimForPublishing` requires another status), so the value is
   * stable within the claim transaction.
   */
  async findMaxAttempt(tx: Transaction, publicationId: string): Promise<number> {
    const [row] = await tx
      .select({
        maxAttempt: sql<number>`COALESCE(MAX(${publicationAttempts.attemptNumber}), 0)::int`,
      })
      .from(publicationAttempts)
      .where(eq(publicationAttempts.publicationId, publicationId));
    return row?.maxAttempt ?? 0;
  }
}
