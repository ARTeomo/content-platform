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
import { webhookEvents } from './webhook-events.js';

/**
 * Durable history of processing attempts for a webhook event.
 *
 * This is the business-history table for webhook processing side effects.
 * It is not a generic worker execution log and does not duplicate BullMQ
 * retry metadata.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.36
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: idColumn(),
    webhookEventId: uuid('webhook_event_id')
      .notNull()
      .references(() => webhookEvents.id, { onDelete: 'cascade' }),
    attemptNumber: integer('attempt_number').notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    startedAt: nullableTimestampColumn('started_at'),
    finishedAt: nullableTimestampColumn('finished_at'),
    errorCategory: varchar('error_category', { length: 64 }),
    errorMessage: text('error_message'),
    workerId: text('worker_id'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('webhook_deliveries_event_attempt_uq').on(
      table.webhookEventId,
      table.attemptNumber,
    ),
    index('webhook_deliveries_status_idx').on(table.status),
    check('webhook_deliveries_attempt_number_check', sql`${table.attemptNumber} > 0`),
    check(
      'webhook_deliveries_status_check',
      sql`${table.status} IN ('PENDING', 'SUCCESS', 'RETRY', 'FAILED', 'DEAD_LETTER')`,
    ),
  ],
);
