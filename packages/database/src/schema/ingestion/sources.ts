import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, updatedAtColumn } from '../_common.js';

/**
 * Logical publisher, brand, or other content source.
 *
 * A Source is **not** a technical endpoint. Endpoint-specific access
 * information belongs to `source_endpoints`. A Source has no `type` or
 * `url` field — those are endpoint properties.
 *
 * The canonical lifecycle is ACTIVE / PAUSED / DISABLED. Reputation is
 * tracked independently as VERIFIED / NEUTRAL / FLAGGED.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.3
 * @see DB v1 Logical Model Specification §3
 */
export const sources = pgTable(
  'sources',
  {
    id: idColumn(),
    name: text('name').notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    reputationState: varchar('reputation_state', { length: 32 }).notNull(),
    priority: integer('priority').notNull().default(100),
    safetyLimits: jsonb('safety_limits').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex('sources_name_uq').on(table.name),
    check('sources_status_check', sql`${table.status} IN ('ACTIVE', 'PAUSED', 'DISABLED')`),
    check(
      'sources_reputation_state_check',
      sql`${table.reputationState} IN ('VERIFIED', 'NEUTRAL', 'FLAGGED')`,
    ),
  ],
);
