import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from '../identity/users.js';

/**
 * Database-backed runtime configuration.
 *
 * The primary key is the configuration key itself (text), not a
 * surrogate UUID. Examples: publication enablement, provider versions,
 * feature flags.
 *
 * `value` is JSONB so it can hold any structure. `updated_by` records
 * the last actor (nullable for system writes). Every change should also
 * produce a row in `config_audit_log`.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.28
 */
export const systemConfig = pgTable('system_config', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
