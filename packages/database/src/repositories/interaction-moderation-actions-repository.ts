import { desc, eq, sql } from 'drizzle-orm';
import { interactionModerationActions } from '../schema/interaction/interaction-moderation-actions.js';
import type { Database, Transaction } from '../transaction/transaction-manager.js';

type ModerationActionRow = typeof interactionModerationActions.$inferSelect;

export type ModerationAction = 'APPROVE' | 'REJECT' | 'EDIT' | 'ESCALATE';

export interface ModerationActionInput {
  responseId: string;
  userId: string;
  action: ModerationAction;
  reason?: string;
  previousBody?: string;
}

/**
 * Repository for interaction moderation decisions.
 *
 * Separate from `moderation_actions` because that table is scoped to
 * publication candidates (content lifecycle), whereas this table is
 * scoped to inbound interactions.
 */
export class InteractionModerationActionsRepository {
  constructor(private readonly db: Database) {}

  async record(tx: Transaction, input: ModerationActionInput): Promise<ModerationActionRow> {
    const [row] = await tx
      .insert(interactionModerationActions)
      .values({
        responseId: input.responseId,
        userId: input.userId,
        action: input.action,
        ...(input.reason !== undefined && { reason: input.reason }),
        ...(input.previousBody !== undefined && { previousBody: input.previousBody }),
      })
      .returning();
    if (!row) throw new Error('Failed to record interaction moderation action');
    return row;
  }

  async findByResponseId(responseId: string): Promise<ModerationActionRow[]> {
    return await this.db
      .select()
      .from(interactionModerationActions)
      .where(eq(interactionModerationActions.responseId, responseId))
      .orderBy(desc(interactionModerationActions.createdAt));
  }

  async countByResponseId(responseId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(interactionModerationActions)
      .where(eq(interactionModerationActions.responseId, responseId));
    return row?.count ?? 0;
  }
}
