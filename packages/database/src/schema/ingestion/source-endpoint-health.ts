import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { nullableTimestampColumn, updatedAtColumn } from '../_common.js';
import { sourceEndpoints } from './source-endpoints.js';

/**
 * Operational health extension for a SourceEndpoint.
 *
 * Strict 1:1 extension. Health is separated from endpoint configuration
 * so high-frequency operational updates do not rewrite relatively stable
 * configuration data. Failure of one endpoint does not imply failure of
 * the logical Source when another endpoint remains healthy.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.5
 * @see ADR-005 (health separation)
 */
export const sourceEndpointHealth = pgTable(
  'source_endpoint_health',
  {
    endpointId: uuid('endpoint_id')
      .primaryKey()
      .references(() => sourceEndpoints.id, { onDelete: 'cascade' }),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastSuccessAt: nullableTimestampColumn('last_success_at'),
    lastFailureAt: nullableTimestampColumn('last_failure_at'),
    lastErrorCategory: varchar('last_error_category', { length: 64 }),
    lastErrorMessage: text('last_error_message'),
    itemsToday: integer('items_today').notNull().default(0),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('source_endpoint_health_last_failure_at_idx').on(table.lastFailureAt),
    check(
      'source_endpoint_health_consecutive_failures_check',
      sql`${table.consecutiveFailures} >= 0`,
    ),
    check('source_endpoint_health_items_today_check', sql`${table.itemsToday} >= 0`),
  ],
);
