import { eq, sql } from 'drizzle-orm';
import { webhookSubscriptionHealth } from '../schema/webhook/webhook-subscription-health.js';
import type { Database, Transaction } from '../transaction/transaction-manager.js';

type WebhookSubscriptionHealthRow = typeof webhookSubscriptionHealth.$inferSelect;

/**
 * Repository for webhook subscription health.
 *
 * Health is a 1:1 extension of a subscription. All writes accept a
 * Transaction so they can participate in the same transaction that
 * records the webhook event.
 */
export class WebhookSubscriptionHealthRepository {
  constructor(private readonly db: Database) {}

  async findById(subscriptionId: string): Promise<WebhookSubscriptionHealthRow | undefined> {
    const [row] = await this.db
      .select()
      .from(webhookSubscriptionHealth)
      .where(eq(webhookSubscriptionHealth.subscriptionId, subscriptionId))
      .limit(1);
    return row;
  }

  /**
   * Record a successful processing attempt. Resets consecutiveFailures.
   */
  async recordSuccess(tx: Transaction, subscriptionId: string, at: Date): Promise<void> {
    await tx
      .update(webhookSubscriptionHealth)
      .set({
        consecutiveSuccesses: sql`${webhookSubscriptionHealth.consecutiveSuccesses} + 1`,
        consecutiveFailures: 0,
        lastSuccessAt: at,
        eventsToday: sql`${webhookSubscriptionHealth.eventsToday} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(webhookSubscriptionHealth.subscriptionId, subscriptionId));
  }

  /**
   * Record a failed processing attempt. Resets consecutiveSuccesses.
   */
  async recordFailure(
    tx: Transaction,
    subscriptionId: string,
    at: Date,
    errorCategory: string,
    errorMessage: string,
  ): Promise<void> {
    await tx
      .update(webhookSubscriptionHealth)
      .set({
        consecutiveFailures: sql`${webhookSubscriptionHealth.consecutiveFailures} + 1`,
        consecutiveSuccesses: 0,
        lastFailureAt: at,
        lastErrorCategory: errorCategory,
        lastErrorMessage: errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(webhookSubscriptionHealth.subscriptionId, subscriptionId));
  }
}
