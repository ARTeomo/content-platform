import { index, inet, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn } from '../_common.js';
import { users } from '../identity/users.js';

/**
 * Append-only history of configuration changes.
 *
 * Every modification to `system_config` should also write a row here.
 * Records are never updated or deleted by application code; corrections
 * are represented by new audit entries.
 *
 * `ip_address` uses PostgreSQL `inet` for structured representation of
 * IPv4 and IPv6.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.29
 */
export const configAuditLog = pgTable(
  'config_audit_log',
  {
    id: idColumn(),
    key: text('key').notNull(),
    oldValue: jsonb('old_value').$type<unknown>(),
    newValue: jsonb('new_value').$type<unknown>(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason'),
    ipAddress: inet('ip_address'),
    createdAt: createdAtColumn(),
  },
  (table) => [index('config_audit_log_key_created_at_idx').on(table.key, table.createdAt)],
);
