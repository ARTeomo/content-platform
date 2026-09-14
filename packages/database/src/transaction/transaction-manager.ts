import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../schema/index.js';

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * The transaction object passed to `db.transaction(callback)`.
 *
 * Extracted from the Drizzle Database type so repository methods can
 * accept a transaction parameter without importing internal Drizzle types.
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Runs a callback inside a PostgreSQL transaction.
 *
 * The transaction manager is the only supported entry point for
 * transactional writes. Repository methods that must participate in a
 * caller-controlled transaction accept a `Transaction` parameter and are
 * invoked inside the callback.
 *
 * @example
 *   await txManager.run(async (tx) => {
 *     const event = await webhookEventsRepo.insert(tx, eventData);
 *     await outboxRepo.enqueue(tx, {
 *       queueName: 'webhook.process',
 *       jobId: `webhook.process:${event.id}`,
 *       payload: { webhookEventId: event.id },
 *     });
 *   });
 */
export class TransactionManager {
  constructor(private readonly db: Database) {}

  async run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return await this.db.transaction(fn);
  }
}
