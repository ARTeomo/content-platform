/**
 * Package barrel for @content-platform/database.
 *
 * Re-exports the client factory and the schema. Consumers should prefer
 * the subpath exports (`@content-platform/database/client` and
 * `@content-platform/database/schema`) when they only need one of the two.
 */

export {
  createDatabaseClient,
  type Database,
  type DatabaseClient,
  type DatabaseConfig,
} from './client.js';

export * as schema from './schema/index.js';
export { TransactionManager, type Transaction } from './transaction/index.js';
export {
  OutboxRepository,
  type OutboxJob,
  type OutboxJobInput,
  type OutboxJobStatus,
} from './repositories/index.js';
