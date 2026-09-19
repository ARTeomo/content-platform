import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { interactionResponses } from '../schema/interaction/interaction-responses.js';
import type { Database, Transaction } from '../transaction/transaction-manager.js';

type InteractionResponseRow = typeof interactionResponses.$inferSelect;

export type InteractionResponseStatus =
  | 'DRAFT'
  | 'AUTO_RESPOND'
  | 'MODERATION_REQUIRED'
  | 'APPROVED'
  | 'REJECTED'
  | 'EDITED'
  | 'SCHEDULED'
  | 'QUEUED'
  | 'IN_PROGRESS'
  | 'RESPONDED'
  | 'RETRY'
  | 'FAILED'
  | 'CANCELLED'
  | 'UNKNOWN'
  | 'RECONCILIATION';

export interface InteractionResponseInput {
  interactionId: string;
  destinationId: string;
  templateId?: string;
  templateVersion?: number;
  body?: string;
  status?: InteractionResponseStatus;
  scheduledAt?: Date;
}

/**
 * Repository for the outbound interaction response lifecycle.
 *
 * One response per interaction (unique constraint on interaction_id).
 * The state machine is enforced by the service layer; this repository
 * is persistence-only.
 */
export class InteractionResponsesRepository {
  constructor(private readonly db: Database) {}

  async create(tx: Transaction, input: InteractionResponseInput): Promise<InteractionResponseRow> {
    const [row] = await tx
      .insert(interactionResponses)
      .values({
        interactionId: input.interactionId,
        destinationId: input.destinationId,
        ...(input.templateId !== undefined && { templateId: input.templateId }),
        ...(input.templateVersion !== undefined && { templateVersion: input.templateVersion }),
        ...(input.body !== undefined && { body: input.body }),
        status: input.status ?? 'DRAFT',
        ...(input.scheduledAt !== undefined && { scheduledAt: input.scheduledAt }),
      })
      .returning();
    if (!row) throw new Error('Failed to insert interaction response');
    return row;
  }

  async findById(id: string): Promise<InteractionResponseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(interactionResponses)
      .where(eq(interactionResponses.id, id))
      .limit(1);
    return row;
  }

  async findByInteractionId(interactionId: string): Promise<InteractionResponseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(interactionResponses)
      .where(eq(interactionResponses.interactionId, interactionId))
      .limit(1);
    return row;
  }

  async updateStatus(
    tx: Transaction,
    id: string,
    status: InteractionResponseStatus,
  ): Promise<void> {
    await tx
      .update(interactionResponses)
      .set({ status, updatedAt: new Date() })
      .where(eq(interactionResponses.id, id));
  }

  async updateBody(tx: Transaction, id: string, body: string): Promise<void> {
    await tx
      .update(interactionResponses)
      .set({ body, updatedAt: new Date() })
      .where(eq(interactionResponses.id, id));
  }

  async setScheduledAt(tx: Transaction, id: string, scheduledAt: Date): Promise<void> {
    await tx
      .update(interactionResponses)
      .set({ scheduledAt, status: 'SCHEDULED', updatedAt: new Date() })
      .where(eq(interactionResponses.id, id));
  }

  async markResponded(
    tx: Transaction,
    id: string,
    externalResponseId: string,
    respondedAt: Date,
  ): Promise<void> {
    await tx
      .update(interactionResponses)
      .set({
        status: 'RESPONDED',
        externalResponseId,
        respondedAt,
        updatedAt: new Date(),
      })
      .where(eq(interactionResponses.id, id));
  }

  async markFailed(tx: Transaction, id: string): Promise<void> {
    await tx
      .update(interactionResponses)
      .set({ status: 'FAILED', updatedAt: new Date() })
      .where(eq(interactionResponses.id, id));
  }

  async markUnknown(tx: Transaction, id: string): Promise<void> {
    await tx
      .update(interactionResponses)
      .set({ status: 'UNKNOWN', updatedAt: new Date() })
      .where(eq(interactionResponses.id, id));
  }

  async findScheduledDue(now: Date, limit: number): Promise<InteractionResponseRow[]> {
    return await this.db
      .select()
      .from(interactionResponses)
      .where(
        and(
          eq(interactionResponses.status, 'SCHEDULED'),
          lte(interactionResponses.scheduledAt, now),
        ),
      )
      .orderBy(interactionResponses.scheduledAt)
      .limit(limit);
  }

  async findModerationPending(limit: number): Promise<InteractionResponseRow[]> {
    return await this.db
      .select()
      .from(interactionResponses)
      .where(eq(interactionResponses.status, 'MODERATION_REQUIRED'))
      .orderBy(desc(interactionResponses.createdAt))
      .limit(limit);
  }

  /**
   * Counts responses created for a destination since the given time.
   * Used by the policy engine's rate limit check.
   */
  async countRecentByDestination(destinationId: string, since: Date): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(interactionResponses)
      .where(
        and(
          eq(interactionResponses.destinationId, destinationId),
          gte(interactionResponses.createdAt, since),
        ),
      );
    return row?.count ?? 0;
  }
}
