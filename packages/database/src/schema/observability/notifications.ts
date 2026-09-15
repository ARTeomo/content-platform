import { boolean, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, nullableTimestampColumn } from '../_common.js';
import { sources } from '../ingestion/sources.js';
import { contentItems } from '../content/content-items.js';
import { publications } from '../publication/publications.js';

/**
 * Durable operational notifications.
 *
 * Notification types must cover at least:
 *   credential failure, system failure, queue backlog,
 *   publication failure, AI budget threshold, source failure.
 *
 * The `type` and `severity` vocabularies are domain-validated and remain
 * text values in DB v1.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.32
 */
export const notifications = pgTable(
  'notifications',
  {
    id: idColumn(),
    type: text('type').notNull(),
    severity: text('severity').notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
    contentId: uuid('content_id').references(() => contentItems.id, { onDelete: 'set null' }),
    publicationId: uuid('publication_id').references(() => publications.id, {
      onDelete: 'set null',
    }),
    isRead: boolean('is_read').notNull().default(false),
    createdAt: createdAtColumn(),
    readAt: nullableTimestampColumn('read_at'),
  },
  (table) => [
    index('notifications_is_read_idx').on(table.isRead),
    index('notifications_created_at_idx').on(table.createdAt),
  ],
);
