import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { idColumn, nullableTimestampColumn, updatedAtColumn } from '../_common.js';
import { destinations } from '../publication/destinations.js';

/**
 * Immutable receipt of a single inbound HTTP POST.
 *
 * One row corresponds to one HTTP transaction: one received body, one
 * signature verification, one idempotency key. The envelope may contain
 * multiple entries and changes; those materialize into
 * `external_interactions` during processing.
 *
 * `raw_payload` and `raw_body_hash` are immutable after insert.
 * `signature_verified` is always true under fail-closed ingress.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.35
 */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: idColumn(),
    provider: varchar('provider', { length: 32 }).notNull(),
    destinationId: uuid('destination_id').references(() => destinations.id, {
      onDelete: 'set null',
    }),
    objectType: varchar('object_type', { length: 32 }).notNull(),
    externalObjectId: text('external_object_id').notNull(),
    field: varchar('field', { length: 64 }),
    idempotencyKey: text('idempotency_key').notNull(),
    rawPayload: jsonb('raw_payload').notNull(),
    rawBodyHash: varchar('raw_body_hash', { length: 128 }).notNull(),
    signatureVerified: boolean('signature_verified').notNull(),
    traceId: uuid('trace_id').notNull().defaultRandom(),
    status: varchar('status', { length: 32 }).notNull().default('RECEIVED'),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    processedAt: nullableTimestampColumn('processed_at'),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex('webhook_events_idempotency_key_uq').on(table.idempotencyKey),
    index('webhook_events_status_received_at_idx').on(table.status, table.receivedAt),
    index('webhook_events_destination_received_at_idx').on(table.destinationId, table.receivedAt),
    index('webhook_events_field_received_at_idx').on(table.field, table.receivedAt),
    index('webhook_events_trace_id_idx').on(table.traceId),
    check(
      'webhook_events_status_check',
      sql`${table.status} IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD_LETTER')`,
    ),
  ],
);
