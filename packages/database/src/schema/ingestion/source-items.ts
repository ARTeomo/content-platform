import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { idColumn, nullableTimestampColumn } from '../_common.js';
import { rawResources } from './raw-resources.js';
import { sources } from './sources.js';
import { contentItems } from '../content/content-items.js';

/**
 * Structured extraction result before platform-level normalization.
 *
 * A SourceItem is an intermediate artifact. It is not the same entity as
 * canonical `ContentItem`. It becomes a ContentItem only after
 * normalization maps it.
 *
 * `raw_resource_id` is nullable because inline extraction may not require
 * acquisition. `content_item_id` is nullable until normalization maps the
 * SourceItem to canonical platform content.
 *
 * The business identity is `(source_id, source_item_id)`.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.10
 * @see DB v1 Logical Model Specification §10
 */
export const sourceItems = pgTable(
  'source_items',
  {
    id: idColumn(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    sourceItemId: text('source_item_id').notNull(),
    sourceUrl: text('source_url').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    content: text('content').notNull(),
    author: text('author'),
    language: text('language'),
    publishedAt: nullableTimestampColumn('published_at'),
    discoveredAt: timestamp('discovered_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    rawResourceId: uuid('raw_resource_id').references(() => rawResources.id, {
      onDelete: 'set null',
    }),
    contentItemId: uuid('content_item_id').references(() => contentItems.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    uniqueIndex('source_items_source_item_id_uq').on(table.sourceId, table.sourceItemId),
    index('source_items_source_discovered_at_idx').on(table.sourceId, table.discoveredAt),
    index('source_items_content_item_id_idx').on(table.contentItemId),
  ],
);
