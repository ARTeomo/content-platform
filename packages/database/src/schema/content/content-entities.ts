import { sql } from 'drizzle-orm';
import { check, index, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn } from '../_common.js';
import { contentItems } from './content-items.js';

/**
 * Extracted named or typed entity associated with canonical content.
 *
 * Entity taxonomy is domain-defined and remains a text value in DB v1.
 * No fixed vocabulary is enforced at the database level.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.14
 */
export const contentEntities = pgTable(
  'content_entities',
  {
    id: idColumn(),
    contentId: uuid('content_id')
      .notNull()
      .references(() => contentItems.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityValue: text('entity_value').notNull(),
    normalizedValue: text('normalized_value'),
    confidence: numeric('confidence', { precision: 5, scale: 4, mode: 'number' }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('content_entities_content_id_idx').on(table.contentId),
    check(
      'content_entities_confidence_check',
      sql`${table.confidence} IS NULL OR (${table.confidence} >= 0 AND ${table.confidence} <= 1)`,
    ),
  ],
);
