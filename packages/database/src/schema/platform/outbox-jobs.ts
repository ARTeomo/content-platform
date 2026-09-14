import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, nullableTimestampColumn } from '../_common.js';

/**
 * Unified transactional outbox.
 *
 * Every durable domain transition that must produce an asynchronous side
 * effect enqueues its job here, inside the same PostgreSQL transaction
 * that commits the domain state. A separate OutboxDispatcher reads
 * PENDING rows and dispatches them to BullMQ.
 *
 * The table has NO foreign keys. This is deliberate: the outbox is a
 * platform primitive whose lifecycle must not be coupled to any domain
 * entity. Cleanup is time-based, not reference-based.
 *
 * `payload` contains identifiers only — never a full document, never a
 * raw payload, never a secret.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.43
 * @see ADR-002 (outbox pattern)
 */
export const outboxJobs = pgTable(
  'outbox_jobs',
  {
    id: idColumn(),
    queueName: varchar('queue_name', { length: 64 }).notNull(),
    jobId: text('job_id').notNull(),
    payload: jsonb('payload').notNull(),
    status: varchar('status', { length: 32 }).notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    lastAttemptAt: nullableTimestampColumn('last_attempt_at'),
    lastError: text('last_error'),
    dispatchedAt: nullableTimestampColumn('dispatched_at'),
    traceId: uuid('trace_id'),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    jobIdUnique: uniqueIndex('outbox_jobs_job_id_uq').on(table.jobId),
    statusCreatedAtIdx: index('outbox_jobs_status_created_at_idx')
      .on(table.status, table.createdAt)
      .where(sql`${table.status} IN ('PENDING', 'DISPATCHING')`),
    statusCheck: check(
      'outbox_jobs_status_check',
      sql`${table.status} IN ('PENDING', 'DISPATCHING', 'DISPATCHED', 'FAILED')`,
    ),
    attemptsCheck: check('outbox_jobs_attempts_check', sql`${table.attempts} >= 0`),
    dispatchedConsistency: check(
      'outbox_jobs_dispatched_consistency',
      sql`(${table.status} = 'DISPATCHED' AND ${table.dispatchedAt} IS NOT NULL) OR (${table.status} <> 'DISPATCHED' AND ${table.dispatchedAt} IS NULL)`,
    ),
  }),
);

export type OutboxJobRow = typeof outboxJobs.$inferSelect;
export type OutboxJobInsert = typeof outboxJobs.$inferInsert;
