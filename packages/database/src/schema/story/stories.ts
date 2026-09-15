import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, updatedAtColumn } from '../_common.js';

/**
 * Thematic grouping of related canonical ContentItems.
 *
 * A Story represents an underlying real-world event or topic, independent
 * of Source identity and independent of duplicate identity. A Story may
 * contain multiple ContentItems (N:M via `story_members`, Phase 8), and
 * a ContentItem may participate in multiple Stories.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.18
 * @see DB v1 Logical Model Specification §16
 */
export const stories = pgTable(
  'stories',
  {
    id: idColumn(),
    title: text('title').notNull(),
    summary: text('summary'),
    status: varchar('status', { length: 32 }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('stories_status_updated_at_idx').on(table.status, table.updatedAt),
    check(
      'stories_status_check',
      sql`${table.status} IN ('FORMING', 'ACTIVE', 'ARCHIVED', 'LOCKED')`,
    ),
  ],
);
