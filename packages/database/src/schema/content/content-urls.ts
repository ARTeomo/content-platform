import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { idColumn } from '../_common.js';
import { contentItems } from './content-items.js';

/**
 * Alternate URL mapped to a canonical ContentItem.
 *
 * The canonical URL itself is owned by `content_items.canonical_url` and
 * is not duplicated here as a CANONICAL row. This table holds ALIAS,
 * AMP, and TRACKING_VARIANT URLs.
 *
 * Global uniqueness on `url` prevents one alternate URL from being
 * assigned to multiple ContentItems.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.12
 */
export const contentUrls = pgTable(
  'content_urls',
  {
    id: idColumn(),
    contentItemId: uuid('content_item_id')
      .notNull()
      .references(() => contentItems.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    urlKind: varchar('url_kind', { length: 32 }).notNull(),
  },
  (table) => [
    uniqueIndex('content_urls_url_uq').on(table.url),
    index('content_urls_content_item_id_idx').on(table.contentItemId),
    check('content_urls_kind_check', sql`${table.urlKind} IN ('ALIAS', 'AMP', 'TRACKING_VARIANT')`),
  ],
);
