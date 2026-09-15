import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn } from '../_common.js';
import { contentItems } from '../content/content-items.js';
import { stories } from '../story/stories.js';
import { sources } from '../ingestion/sources.js';
import { publications } from '../publication/publications.js';

/**
 * Optionally persisted structured operational and application logs.
 *
 * Runtime logging does not require every log line to be persisted in
 * PostgreSQL. This table is for selected records that benefit from
 * durable storage and SQL-based correlation.
 *
 * `job_id` is a correlation reference only. It does not make worker
 * execution state authoritative in PostgreSQL — BullMQ remains the
 * source of truth for queue state.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.31
 */
export const systemLogs = pgTable(
  'system_logs',
  {
    id: idColumn(),
    level: text('level').notNull(),
    event: text('event').notNull(),
    message: text('message'),
    traceId: uuid('trace_id'),
    contentId: uuid('content_id').references(() => contentItems.id, { onDelete: 'set null' }),
    storyId: uuid('story_id').references(() => stories.id, { onDelete: 'set null' }),
    sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
    jobId: text('job_id'),
    publicationId: uuid('publication_id').references(() => publications.id, {
      onDelete: 'set null',
    }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('system_logs_trace_id_idx').on(table.traceId),
    index('system_logs_created_at_idx').on(table.createdAt),
  ],
);
