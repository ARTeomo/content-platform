import { and, eq } from 'drizzle-orm';
import { webhookEndpoints } from '../schema/webhook/webhook-endpoints.js';
import type { Database, Transaction } from '../transaction/transaction-manager.js';

type WebhookEndpointRow = typeof webhookEndpoints.$inferSelect;

export interface WebhookEndpointInput {
  provider: string;
  name: string;
  verifyTokenEncrypted: string;
  verifyTokenKeyVersion: number;
  status?: 'ACTIVE' | 'PAUSED' | 'DISABLED';
}

/**
 * Repository for App-level webhook configuration endpoints (v1.3 D-013).
 *
 * The endpoint owns the App-level verify token. Subscriptions reference
 * the endpoint via `endpoint_id`; they never decrypt the token themselves.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.45
 */
export class WebhookEndpointsRepository {
  constructor(private readonly db: Database) {}

  async create(tx: Transaction, input: WebhookEndpointInput): Promise<WebhookEndpointRow> {
    const [row] = await tx
      .insert(webhookEndpoints)
      .values({
        provider: input.provider,
        name: input.name,
        verifyTokenEncrypted: input.verifyTokenEncrypted,
        verifyTokenKeyVersion: input.verifyTokenKeyVersion,
        status: input.status ?? 'ACTIVE',
      })
      .returning();
    if (!row) throw new Error('Failed to insert webhook endpoint');
    return row;
  }

  async findById(id: string): Promise<WebhookEndpointRow | undefined> {
    const [row] = await this.db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, id))
      .limit(1);
    return row;
  }

  async findByProviderAndName(
    provider: string,
    name: string,
  ): Promise<WebhookEndpointRow | undefined> {
    const [row] = await this.db
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.provider, provider), eq(webhookEndpoints.name, name)))
      .limit(1);
    return row;
  }

  /**
   * List all ACTIVE endpoints for a provider. Used by the dual-read
   * handshake (D-013b) to find the endpoint whose verify token matches
   * the incoming `hub.verify_token`.
   */
  async findActiveByProvider(provider: string): Promise<WebhookEndpointRow[]> {
    return await this.db
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.provider, provider), eq(webhookEndpoints.status, 'ACTIVE')));
  }

  async updateStatus(
    tx: Transaction,
    id: string,
    status: 'ACTIVE' | 'PAUSED' | 'DISABLED',
  ): Promise<void> {
    await tx
      .update(webhookEndpoints)
      .set({ status, updatedAt: new Date() })
      .where(eq(webhookEndpoints.id, id));
  }

  async touchVerifiedAt(tx: Transaction, id: string, at: Date): Promise<void> {
    await tx
      .update(webhookEndpoints)
      .set({ lastVerifiedAt: at, updatedAt: new Date() })
      .where(eq(webhookEndpoints.id, id));
  }

  async updateVerifyToken(
    tx: Transaction,
    id: string,
    verifyTokenEncrypted: string,
    verifyTokenKeyVersion: number,
    at: Date,
  ): Promise<void> {
    await tx
      .update(webhookEndpoints)
      .set({
        verifyTokenEncrypted,
        verifyTokenKeyVersion,
        lastRotatedAt: at,
        updatedAt: new Date(),
      })
      .where(eq(webhookEndpoints.id, id));
  }
}
