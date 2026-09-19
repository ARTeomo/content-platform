import { desc, eq, sql } from 'drizzle-orm';
import { interactionResponseReconciliations } from '../schema/interaction/interaction-response-reconciliations.js';
import type { Database, Transaction } from '../transaction/transaction-manager.js';

type ReconciliationRow = typeof interactionResponseReconciliations.$inferSelect;

export type ReconciliationStatus = 'RESPONDED' | 'RETRY_ELIGIBLE' | 'UNKNOWN';

export interface ReconciliationInput {
  responseId: string;
  attemptId?: string;
  status: ReconciliationStatus;
  checkedAt?: Date;
  externalResponseId?: string;
  details?: Record<string, unknown>;
}

export class InteractionResponseReconciliationsRepository {
  constructor(private readonly db: Database) {}

  async record(tx: Transaction, input: ReconciliationInput): Promise<ReconciliationRow> {
    const [row] = await tx
      .insert(interactionResponseReconciliations)
      .values({
        responseId: input.responseId,
        ...(input.attemptId !== undefined && { attemptId: input.attemptId }),
        status: input.status,
        checkedAt: input.checkedAt ?? new Date(),
        ...(input.externalResponseId !== undefined && {
          externalResponseId: input.externalResponseId,
        }),
        ...(input.details !== undefined && { details: input.details }),
      })
      .returning();
    if (!row) throw new Error('Failed to record interaction response reconciliation');
    return row;
  }

  async findByResponseId(responseId: string): Promise<ReconciliationRow[]> {
    return await this.db
      .select()
      .from(interactionResponseReconciliations)
      .where(eq(interactionResponseReconciliations.responseId, responseId))
      .orderBy(desc(interactionResponseReconciliations.createdAt));
  }

  async findLatestForResponse(responseId: string): Promise<ReconciliationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(interactionResponseReconciliations)
      .where(eq(interactionResponseReconciliations.responseId, responseId))
      .orderBy(desc(interactionResponseReconciliations.createdAt))
      .limit(1);
    return row;
  }

  /**
   * Counts reconciliation records for a response. Used to produce a
   * deterministic, monotonic job id suffix for retry enqueues.
   */
  async countForResponse(responseId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(interactionResponseReconciliations)
      .where(eq(interactionResponseReconciliations.responseId, responseId));
    return row?.count ?? 0;
  }
}
