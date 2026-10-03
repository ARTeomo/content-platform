import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
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

export interface CreateIdempotentResult {
  row: InteractionResponseRow;
  /** True if this call performed the insert. False if an existing row was reused. */
  inserted: boolean;
}

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

  async createIdempotent(
    tx: Transaction,
    input: InteractionResponseInput,
  ): Promise<CreateIdempotentResult> {
    const [inserted] = await tx
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
      .onConflictDoNothing({ target: interactionResponses.interactionId })
      .returning();

    if (inserted) return { row: inserted, inserted: true };

    const [existing] = await tx
      .select()
      .from(interactionResponses)
      .where(eq(interactionResponses.interactionId, input.interactionId))
      .limit(1);

    if (!existing) {
      throw new Error(
        'createIdempotent reported conflict but no matching interaction_responses row was found',
      );
    }
    return { row: existing, inserted: false };
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

  async findByDestinationAndExternalResponseId(
    destinationId: string,
    externalResponseId: string,
  ): Promise<InteractionResponseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(interactionResponses)
      .where(
        and(
          eq(interactionResponses.destinationId, destinationId),
          eq(interactionResponses.externalResponseId, externalResponseId),
        ),
      )
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

  async claimForResponding(
    tx: Transaction,
    id: string,
    expected: InteractionResponseStatus[],
  ): Promise<InteractionResponseRow | undefined> {
    if (expected.length === 0) return undefined;
    const rows = await tx
      .update(interactionResponses)
      .set({ status: 'IN_PROGRESS', updatedAt: new Date() })
      .where(and(eq(interactionResponses.id, id), inArray(interactionResponses.status, expected)))
      .returning();
    return rows[0];
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

  async markRetry(tx: Transaction, id: string): Promise<void> {
    await tx
      .update(interactionResponses)
      .set({ status: 'RETRY', updatedAt: new Date() })
      .where(eq(interactionResponses.id, id));
  }

  /**
   * Atomically claim due SCHEDULED responses for delivery.
   */
  async claimDueScheduled(tx: Transaction, limit: number): Promise<string[]> {
    const rows = (await tx.execute(sql`
      WITH claimed AS (
        SELECT id FROM interaction_responses
        WHERE status = 'SCHEDULED'
          AND scheduled_at IS NOT NULL
          AND scheduled_at <= now()
        ORDER BY scheduled_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE interaction_responses
      SET status = 'QUEUED',
          updated_at = now()
      WHERE id IN (SELECT id FROM claimed)
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  /**
   * Read-only diagnostic: list unresolved response IDs without
   * claiming them.
   *
   * "Unresolved" covers two statuses with the same operational
   * meaning — the response's external outcome is uncertain and needs
   * a pull reconciliation:
   *
   *   - IN_PROGRESS  — a worker started but never reported back
   *   - UNKNOWN      — a worker reported a network/unknown error
   *
   * Prefer `touchStaleUnresolved` inside the scheduler transaction.
   */
  async findStaleUnresolved(thresholdSeconds: number, limit: number): Promise<string[]> {
    const rows = (await this.db.execute(sql`
      SELECT id FROM interaction_responses
      WHERE status IN ('IN_PROGRESS', 'UNKNOWN')
        AND updated_at < now() - interval '${sql.raw(String(thresholdSeconds))} seconds'
      ORDER BY updated_at ASC
      LIMIT ${limit}
    `)) as unknown as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  /**
   * Atomically claim stale unresolved rows by touching `updated_at`.
   *
   * Used inside a transaction by the interaction response scheduler so
   * that the outbox enqueue and the "we have seen this row" marker are
   * committed together.
   */
  async touchStaleUnresolved(
    tx: Transaction,
    thresholdSeconds: number,
    limit: number,
  ): Promise<string[]> {
    const rows = (await tx.execute(sql`
      WITH claimed AS (
        SELECT id FROM interaction_responses
        WHERE status IN ('IN_PROGRESS', 'UNKNOWN')
          AND updated_at < now() - interval '${sql.raw(String(thresholdSeconds))} seconds'
        ORDER BY updated_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE interaction_responses
      SET updated_at = now()
      WHERE id IN (SELECT id FROM claimed)
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    return rows.map((r) => r.id);
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
