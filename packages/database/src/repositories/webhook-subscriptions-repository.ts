import { and, eq } from 'drizzle-orm';
import {
  webhookSubscriptions,
  type webhookSubscriptions as ws,
} from '../schema/webhook/webhook-subscriptions.js';
import { webhookSubscriptionHealth } from '../schema/webhook/webhook-subscription-health.js';
import type { Database, Transaction } from '../transaction/transaction-manager.js';

type WebhookSubscriptionRow = typeof webhookSubscriptions.$inferSelect;
type WebhookSubscriptionHealthRow = typeof webhookSubscriptionHealth.$inferSelect;

export interface WebhookSubscriptionInput {
  destinationId: string;
  provider: string;
  fields: string[];
  verifyTokenEncrypted: string;
  verifyTokenKeyVersion: number;
  status?: 'ACTIVE' | 'PAUSED' | 'DISABLED';
}

/**
 * Repository for webhook subscriptions.
 *
 * Creation also inserts the 1:1 health companion row in the same
 * transaction. This enforces the invariant that a subscription always
 * has a health record.
 */
export class WebhookSubscriptionsRepository {
  constructor(private readonly db: Database) {}

  async create(tx: Transaction, input: WebhookSubscriptionInput): Promise<WebhookSubscriptionRow> {
    const [sub] = await tx
      .insert(webhookSubscriptions)
      .values({
        destinationId: input.destinationId,
        provider: input.provider,
        fields: input.fields,
        verifyTokenEncrypted: input.verifyTokenEncrypted,
        verifyTokenKeyVersion: input.verifyTokenKeyVersion,
        status: input.status ?? 'ACTIVE',
      })
      .returning();

    if (!sub) {
      throw new Error('Failed to insert webhook subscription');
    }

    await tx.insert(webhookSubscriptionHealth).values({ subscriptionId: sub.id });

    return sub;
  }

  async findById(id: string): Promise<WebhookSubscriptionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.id, id))
      .limit(1);
    return row;
  }

  async findByDestinationAndProvider(
    destinationId: string,
    provider: string,
  ): Promise<WebhookSubscriptionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(webhookSubscriptions)
      .where(
        and(
          eq(webhookSubscriptions.destinationId, destinationId),
          eq(webhookSubscriptions.provider, provider),
        ),
      )
      .limit(1);
    return row;
  }

  async findWithHealth(
    id: string,
  ): Promise<
    | { subscription: WebhookSubscriptionRow; health: WebhookSubscriptionHealthRow | undefined }
    | undefined
  > {
    const [row] = await this.db
      .select()
      .from(webhookSubscriptions)
      .leftJoin(
        webhookSubscriptionHealth,
        eq(webhookSubscriptionHealth.subscriptionId, webhookSubscriptions.id),
      )
      .where(eq(webhookSubscriptions.id, id))
      .limit(1);

    if (!row) return undefined;
    return {
      subscription: row.webhook_subscriptions,
      health: row.webhook_subscription_health ?? undefined,
    };
  }

  async updateStatus(
    tx: Transaction,
    id: string,
    status: 'ACTIVE' | 'PAUSED' | 'DISABLED',
  ): Promise<void> {
    await tx
      .update(webhookSubscriptions)
      .set({ status, updatedAt: new Date() })
      .where(eq(webhookSubscriptions.id, id));
  }

  async touchVerifiedAt(tx: Transaction, id: string, at: Date): Promise<void> {
    await tx
      .update(webhookSubscriptions)
      .set({ lastVerifiedAt: at, updatedAt: new Date() })
      .where(eq(webhookSubscriptions.id, id));
  }
}
