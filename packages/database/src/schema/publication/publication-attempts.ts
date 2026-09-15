import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, nullableTimestampColumn } from '../_common.js';
import { publications } from './publications.js';

/**
 * Durable publication execution history.
 *
 * This is a business-history table for publication side effects. It is
 * not a generic worker execution log and does not duplicate BullMQ retry
 * metadata.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.26
 */
export const publicationAttempts = pgTable(
  'publication_attempts',
  {
    id: idColumn(),
    publicationId: uuid('publication_id')
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
    attemptNumber: integer('attempt_number').notNull(),
    status: text('status').notNull(),
    startedAt: nullableTimestampColumn('started_at'),
    finishedAt: nullableTimestampColumn('finished_at'),
    errorCategory: text('error_category'),
    errorMessage: text('error_message'),
    externalPostId: text('external_post_id'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('publication_attempts_pub_attempt_uq').on(table.publicationId, table.attemptNumber),
    index('publication_attempts_status_idx').on(table.status),
    check('publication_attempts_attempt_number_check', sql`${table.attemptNumber} > 0`),
    check(
      'publication_attempts_status_check',
      sql`${table.status} IN ('PENDING', 'SUCCESS', 'RETRY', 'FAILED', 'DEAD_LETTER', 'UNKNOWN')`,
    ),
  ],
);
