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
} from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, nullableTimestampColumn } from '../_common.js';
import { interactionResponses } from './interaction-responses.js';

/**
 * Durable history of outbound response execution.
 *
 * `request_payload_hash` enables deterministic reconciliation: two
 * attempts with the same hash were the same logical request, and the
 * provider may deduplicate them.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.40
 */
export const interactionResponseAttempts = pgTable(
  'interaction_response_attempts',
  {
    id: idColumn(),
    responseId: uuid('response_id')
      .notNull()
      .references(() => interactionResponses.id, { onDelete: 'cascade' }),
    attemptNumber: integer('attempt_number').notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    startedAt: nullableTimestampColumn('started_at'),
    finishedAt: nullableTimestampColumn('finished_at'),
    errorCategory: varchar('error_category', { length: 64 }),
    errorMessage: text('error_message'),
    externalResponseId: text('external_response_id'),
    requestPayloadHash: varchar('request_payload_hash', { length: 128 }).notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('interaction_response_attempts_response_attempt_uq').on(
      table.responseId,
      table.attemptNumber,
    ),
    index('interaction_response_attempts_status_idx').on(table.status),
    check('interaction_response_attempts_attempt_number_check', sql`${table.attemptNumber} > 0`),
    check(
      'interaction_response_attempts_status_check',
      sql`${table.status} IN ('PENDING', 'SUCCESS', 'RETRY', 'FAILED', 'DEAD_LETTER', 'UNKNOWN')`,
    ),
  ],
);
