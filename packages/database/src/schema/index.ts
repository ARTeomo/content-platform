/**
 * Central schema export.
 *
 * Every Drizzle table definition must be re-exported from this file so that:
 *   - drizzle-kit discovers all tables during migration generation;
 *   - the runtime client receives the full schema for relational queries.
 *
 * Migration order follows DATABASE_SCHEMA_CONTRACT.md §20.
 */

// Phase 2 — foundation tables
export * from './identity/index.js';
export * from './publication/index.js';

// Phase 3 — platform pattern
export * from './platform/index.js';

// Phase 4 — webhook persistence
export * from './webhook/index.js';

// Phase 5-6 — ingestion layer
export * from './ingestion/index.js';

// Phase 7 — story and content layer
export * from './story/index.js';
export * from './content/index.js';
