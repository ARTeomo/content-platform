import { desc, eq, sql } from 'drizzle-orm';
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
        attemptNumber:
          sql`COALESCE((SELECT MAX(attempt_number) FROM publication_attempts WHERE publication_id = ${publicationId}), 0) + 1` as unknown as number,
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
}
