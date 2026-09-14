import { desc, eq, sql } from 'drizzle-orm';
import { webhookDeliveries } from '../schema/webhook/webhook-deliveries.js';
import type { Database, Transaction } from '../transaction/transaction-manager.js';

type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;

export interface WebhookDeliveryStart {
  webhookEventId: string;
  workerId?: string;
}

/**
 * Repository for webhook processing attempt history.
 */
export class WebhookDeliveriesRepository {
  constructor(private readonly db: Database) {}

  /**
   * Start a new delivery attempt. Computes attempt_number as
   * MAX(existing) + 1 for the event.
   *
   * Safe under concurrency because the unique constraint on
   * (webhook_event_id, attempt_number) rejects duplicate attempts, and
   * the only concurrent writer for a given event is the single worker
   * that holds the event claim.
   */
  async startAttempt(tx: Transaction, input: WebhookDeliveryStart): Promise<WebhookDeliveryRow> {
    const [row] = await tx
      .insert(webhookDeliveries)
      .values({
        webhookEventId: input.webhookEventId,
        attemptNumber:
          sql`COALESCE((SELECT MAX(attempt_number) FROM webhook_deliveries WHERE webhook_event_id = ${input.webhookEventId}), 0) + 1` as unknown as number,
        status: 'PENDING',
        startedAt: new Date(),
        workerId: input.workerId ?? null,
      })
      .returning();

    if (!row) {
      throw new Error('Failed to insert webhook delivery attempt');
    }
    return row;
  }

  async finishSuccess(tx: Transaction, deliveryId: string, at: Date): Promise<void> {
    await tx
      .update(webhookDeliveries)
      .set({ status: 'SUCCESS', finishedAt: at })
      .where(eq(webhookDeliveries.id, deliveryId));
  }

  async finishFailure(
    tx: Transaction,
    deliveryId: string,
    at: Date,
    status: 'RETRY' | 'FAILED' | 'DEAD_LETTER',
    errorCategory: string,
    errorMessage: string,
  ): Promise<void> {
    await tx
      .update(webhookDeliveries)
      .set({
        status,
        finishedAt: at,
        errorCategory,
        errorMessage,
      })
      .where(eq(webhookDeliveries.id, deliveryId));
  }

  async findLatestForEvent(webhookEventId: string): Promise<WebhookDeliveryRow | undefined> {
    const [row] = await this.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookEventId, webhookEventId))
      .orderBy(desc(webhookDeliveries.attemptNumber))
      .limit(1);
    return row;
  }

  async countForEvent(webhookEventId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookEventId, webhookEventId));
    return row?.count ?? 0;
  }
}
