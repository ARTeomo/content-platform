import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Shared column builders for the content-platform schema.
 *
 * Every table must use these helpers for the columns they model, to keep
 * the persistence contract (DATABASE_SCHEMA_CONTRACT.md §4) consistent:
 *
 *   - UUID primary keys use `gen_random_uuid()`, which requires the
 *     `pgcrypto` extension. See ADR-003.
 *
 *   - All temporal fields use `timestamptz` (UTC instants). Business
 *     timezone conversion belongs to the scheduling subsystem, not the
 *     persistence layer.
 *
 *   - `updated_at` is NOT auto-updated by the database. See ADR-004.
 */

/**
 * Standard UUID primary key column.
 *
 * Maps to:
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid()
 */
export const idColumn = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);

/**
 * Standard `created_at` timestamp column.
 *
 * Maps to:
 *   created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 */
export const createdAtColumn = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

/**
 * Standard `updated_at` timestamp column.
 *
 * Maps to:
 *   updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
 *
 * Architectural Note:
 *
 * This column does NOT auto-update on row change. The application layer
 * must set it explicitly on UPDATE. See ADR-004 for the rationale.
 */
export const updatedAtColumn = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

/**
 * Optional timestamp column (nullable).
 *
 * Use for fields such as `last_success_at`, `processed_at`,
 * `dispatched_at`, `scheduled_at`, `responded_at`, `expires_at`.
 *
 * @param name - The column name in snake_case.
 */
export const nullableTimestampColumn = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' });
