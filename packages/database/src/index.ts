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
