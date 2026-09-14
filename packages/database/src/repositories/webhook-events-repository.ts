import { eq } from 'drizzle-orm';
import { webhookEvents } from '../schema/webhook/webhook-events.js';
import type { Database, Transaction } from '../transaction/transaction-manager.js';

type WebhookEventRow = typeof webhookEvents.$inferSelect;

export interface WebhookEventInput {
  provider: string;
  destinationId?: string;
  objectType: string;
  externalObjectId: string;
  field?: string;
  idempotencyKey: string;
  rawPayload: Record<string, unknown>;
  rawBodyHash: string;
  traceId?: string;
}

export interface InsertResult {
  inserted: boolean;
  event: WebhookEventRow;
}

/**
 * Repository for webhook event receipts.
 *
 * The central operation is `insertIdempotent`, which must be called
 * inside a caller-controlled transaction. It is the entry point for the
 * webhook ingress and its return value determines whether the caller
 * should enqueue an outbox job.
 */
export class WebhookEventsRepository {
  constructor(private readonly db: Database) {}

  /**
   * Insert a new webhook event, or return the existing one if the
   * idempotency key already exists.
   *
   * Must be called inside a caller-controlled transaction so the caller
   * can atomically enqueue an outbox job when `inserted` is true.
   */
  async insertIdempotent(tx: Transaction, input: WebhookEventInput): Promise<InsertResult> {
    const inserted = await tx
      .insert(webhookEvents)
      .values({
        provider: input.provider,
        destinationId: input.destinationId ?? null,
        objectType: input.objectType,
        externalObjectId: input.externalObjectId,
        field: input.field ?? null,
        idempotencyKey: input.idempotencyKey,
        rawPayload: input.rawPayload,
        rawBodyHash: input.rawBodyHash,
        signatureVerified: true,
        ...(input.traceId !== undefined && { traceId: input.traceId }),
      })
      .onConflictDoNothing({ target: webhookEvents.idempotencyKey })
      .returning();

    const first = inserted[0];
    if (first) {
      return { inserted: true, event: first };
    }

    const [existing] = await tx
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.idempotencyKey, input.idempotencyKey))
      .limit(1);

    if (!existing) {
      throw new Error('Idempotency conflict reported by PostgreSQL but no matching row found');
    }

    return { inserted: false, event: existing };
  }

  async findById(id: string): Promise<WebhookEventRow | undefined> {
    const [row] = await this.db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, id))
      .limit(1);
    return row;
  }

  async markProcessing(tx: Transaction, id: string): Promise<void> {
    await tx
      .update(webhookEvents)
      .set({ status: 'PROCESSING', updatedAt: new Date() })
      .where(eq(webhookEvents.id, id));
  }

  async markProcessed(tx: Transaction, id: string, at: Date): Promise<void> {
    await tx
      .update(webhookEvents)
      .set({ status: 'PROCESSED', processedAt: at, updatedAt: at })
      .where(eq(webhookEvents.id, id));
  }

  async markFailed(tx: Transaction, id: string): Promise<void> {
    await tx
      .update(webhookEvents)
      .set({ status: 'FAILED', updatedAt: new Date() })
      .where(eq(webhookEvents.id, id));
  }
}
