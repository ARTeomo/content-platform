import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn } from '../_common.js';
import { users } from '../identity/users.js';

/**
 * Append-only cross-domain audit trail for important application and
 * administrative events that do not already have a dedicated structured
 * history table.
 *
 * This table supplements, but does not replace, dedicated business
 * history structures such as `config_audit_log`, `moderation_actions`,
 * `publication_attempts`, `publication_reconciliations`,
 * `webhook_deliveries`, and `interaction_response_attempts`.
 *
 * ## Polymorphic entity reference
 *
 * `entity_id` is intentionally not a polymorphic foreign key because one
 * PostgreSQL column cannot safely reference multiple entity tables. The
 * pair (entity_type, entity_id) is application-validated.
 *
 * ## Append-only
 *
 * Records are never updated or deleted by application code. Corrections
 * are represented by new audit events.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.33
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: idColumn(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    changes: jsonb('changes').$type<Record<string, unknown>>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('audit_logs_entity_idx').on(table.entityType, table.entityId, table.createdAt),
    index('audit_logs_actor_created_at_idx').on(table.actorUserId, table.createdAt),
    index('audit_logs_action_created_at_idx').on(table.action, table.createdAt),
  ],
);
