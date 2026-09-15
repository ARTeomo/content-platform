import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, updatedAtColumn } from '../_common.js';
import { sources } from './sources.js';

/**
 * Concrete technical access point belonging to a Source.
 *
 * One Source may expose multiple endpoints for different discovery,
 * acquisition, and extraction strategies. Endpoint-specific incremental
 * state, scheduling, and configuration live here, not on the logical
 * Source.
 *
 * `state` is polymorphic, discriminated by `kind`:
 *   FEED | SITEMAP | PAGINATION | API | STATELESS
 *
 * `state_version` provides optimistic concurrency control. A worker may
 * update state only if the persisted version equals the observed version.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.4
 * @see ADR-005 (health separation)
 */
export const sourceEndpoints = pgTable(
  'source_endpoints',
  {
    id: idColumn(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    representation: varchar('representation', { length: 32 }).notNull(),
    capabilities: text('capabilities').array().notNull(),
    url: text('url').notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    nextPollAt: timestamp('next_poll_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    stateVersion: integer('state_version').notNull().default(0),
    state: jsonb('state').$type<Record<string, unknown>>().notNull().default({ kind: 'STATELESS' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex('source_endpoints_source_url_uq').on(table.sourceId, table.url),
    index('source_endpoints_status_next_poll_at_idx').on(table.status, table.nextPollAt),
    check(
      'source_endpoints_representation_check',
      sql`${table.representation} IN ('XML', 'HTML', 'JSON', 'UNKNOWN')`,
    ),
    check(
      'source_endpoints_status_check',
      sql`${table.status} IN ('ACTIVE', 'PAUSED', 'DISABLED')`,
    ),
    check('source_endpoints_state_version_check', sql`${table.stateVersion} >= 0`),
    check(
      'source_endpoints_capabilities_nonempty_check',
      sql`array_length(${table.capabilities}, 1) IS NOT NULL`,
    ),
  ],
);
