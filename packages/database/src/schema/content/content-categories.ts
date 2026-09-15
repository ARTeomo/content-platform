import { sql } from 'drizzle-orm';
import { check, index, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn } from '../_common.js';
import { contentItems } from './content-items.js';

/**
 * Category assignment for canonical content.
 *
 * Category vocabulary is domain/configuration-defined and remains a text
 * value in DB v1.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.15
 */
export const contentCategories = pgTable(
  'content_categories',
  {
    id: idColumn(),
    contentId: uuid('content_id')
      .notNull()
      .references(() => contentItems.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    confidence: numeric('confidence', { precision: 5, scale: 4, mode: 'number' }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('content_categories_content_id_idx').on(table.contentId),
    check(
      'content_categories_confidence_check',
      sql`${table.confidence} IS NULL OR (${table.confidence} >= 0 AND ${table.confidence} <= 1)`,
    ),
  ],
);
