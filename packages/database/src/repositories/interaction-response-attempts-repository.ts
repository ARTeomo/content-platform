import { desc, eq, sql } from 'drizzle-orm';
import { interactionResponseAttempts } from '../schema/interaction/interaction-response-attempts.js';
import type { Database, Transaction } from '../transaction/transaction-manager.js';

type AttemptRow = typeof interactionResponseAttempts.$inferSelect;

export type AttemptStatus = 'PENDING' | 'SUCCESS' | 'RETRY' | 'FAILED' | 'DEAD_LETTER' | 'UNKNOWN';

/**
 * Repository for outbound interaction response execution attempts.
 *
 * attempt_number is computed as MAX(existing) + 1 for the response. The
 * unique constraint on (response_id, attempt_number) rejects concurrent
 * duplicates.
 */
export class InteractionResponseAttemptsRepository {
  constructor(private readonly db: Database) {}

  async startAttempt(
    tx: Transaction,
    responseId: string,
    requestPayloadHash: string,
  ): Promise<AttemptRow> {
    const [row] = await tx
      .insert(interactionResponseAttempts)
      .values({
        responseId,
        attemptNumber:
          sql`COALESCE((SELECT MAX(attempt_number) FROM interaction_response_attempts WHERE response_id = ${responseId}), 0) + 1` as unknown as number,
        status: 'PENDING',
        startedAt: new Date(),
        requestPayloadHash,
      })
      .returning();
    if (!row) throw new Error('Failed to start interaction response attempt');
    return row;
  }

  async finishSuccess(
    tx: Transaction,
    attemptId: string,
    at: Date,
    externalResponseId?: string,
  ): Promise<void> {
    await tx
      .update(interactionResponseAttempts)
      .set({
        status: 'SUCCESS',
        finishedAt: at,
        ...(externalResponseId !== undefined && { externalResponseId }),
      })
      .where(eq(interactionResponseAttempts.id, attemptId));
  }

  async finishFailure(
    tx: Transaction,
    attemptId: string,
    at: Date,
    status: AttemptStatus,
    errorCategory: string,
    errorMessage: string,
  ): Promise<void> {
    await tx
      .update(interactionResponseAttempts)
      .set({
        status,
        finishedAt: at,
        errorCategory,
        errorMessage,
      })
      .where(eq(interactionResponseAttempts.id, attemptId));
  }

  async findLatestForResponse(responseId: string): Promise<AttemptRow | undefined> {
    const [row] = await this.db
      .select()
      .from(interactionResponseAttempts)
      .where(eq(interactionResponseAttempts.responseId, responseId))
      .orderBy(desc(interactionResponseAttempts.attemptNumber))
      .limit(1);
    return row;
  }

  async countForResponse(responseId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(interactionResponseAttempts)
      .where(eq(interactionResponseAttempts.responseId, responseId));
    return row?.count ?? 0;
  }
}
