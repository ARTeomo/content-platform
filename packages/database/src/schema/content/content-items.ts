import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, nullableTimestampColumn, updatedAtColumn } from '../_common.js';

/**
 * Platform-level canonical content identity.
 *
 * A ContentItem is independent of any single SourceItem, source endpoint,
 * or discovery URL. Its canonical URL is unique at this layer; alternate
 * URLs are stored separately in `content_urls` (Phase 8).
 *
 * ## Mutual FK with content_versions
 *
 * `content_items.current_version_id` → `content_versions.id` and
 * `content_versions.content_item_id` → `content_items.id` form a mutual
 * dependency. Both references use a lazy callback (`(): AnyPgColumn =>`)
 * so that Drizzle can order the CREATE TABLE and ALTER TABLE statements
 * correctly within a single migration.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.11
 * @see DB v1 Logical Model Specification §11
 */
export const contentItems = pgTable(
  'content_items',
  {
    id: idColumn(),
    canonicalUrl: text('canonical_url').notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    publishedAt: nullableTimestampColumn('published_at'),
    currentVersionId: uuid('current_version_id').references((): AnyPgColumn => contentVersions.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex('content_items_canonical_url_uq').on(table.canonicalUrl),
    index('content_items_status_published_at_idx').on(table.status, table.publishedAt),
    check(
      'content_items_status_check',
      sql`${table.status} IN ('DRAFT', 'PUBLISHED', 'ARCHIVED', 'TRASHED')`,
    ),
  ],
);

/**
 * Immutable normalized representation of a ContentItem at a particular
 * processing revision.
 *
 * Historical representations are retained here. `version_number` is
 * strictly positive and unique per ContentItem. Versions are immutable
 * after creation.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.13
 * @see DB v1 Logical Model Specification §13
 */
export const contentVersions = pgTable(
  'content_versions',
  {
    id: idColumn(),
    contentItemId: uuid('content_item_id')
      .notNull()
      .references((): AnyPgColumn => contentItems.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    processingVersion: varchar('processing_version', { length: 64 }).notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('content_versions_item_version_uq').on(table.contentItemId, table.versionNumber),
    index('content_versions_item_version_desc_idx').on(
      table.contentItemId,
      table.versionNumber.desc(),
    ),
    check('content_versions_version_number_check', sql`${table.versionNumber} > 0`),
  ],
);
