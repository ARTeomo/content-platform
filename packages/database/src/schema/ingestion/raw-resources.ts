import { index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { idColumn } from '../_common.js';
import { discoveredResources } from './discovered-resources.js';

/**
 * Raw acquisition artifact retained for diagnostics, retries,
 * auditability, and re-extraction.
 *
 * One DiscoveredResource may have multiple RawResource snapshots because
 * acquisition may occur multiple times. A failed acquisition that does
 * not produce a raw artifact does not create a row.
 *
 * Raw resources are operational snapshots. There is no `updated_at`.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.9
 * @see DB v1 Logical Model Specification §9
 */
export const rawResources = pgTable(
  'raw_resources',
  {
    id: idColumn(),
    discoveredResourceId: uuid('discovered_resource_id')
      .notNull()
      .references(() => discoveredResources.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    contentType: varchar('content_type', { length: 128 }).notNull(),
    body: text('body').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('raw_resources_resource_fetched_at_idx').on(table.discoveredResourceId, table.fetchedAt),
  ],
);
