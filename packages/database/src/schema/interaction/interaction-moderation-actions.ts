import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn } from '../_common.js';
import { users } from '../identity/users.js';
import { interactionResponses } from './interaction-responses.js';

/**
 * Durable moderation decision history for interaction responses.
 *
 * This table is deliberately separate from `moderation_actions` because
 * that table is scoped to `publication_candidates` (content lifecycle),
 * whereas this table is scoped to inbound interactions.
 *
 * `previous_body` is required when the action is EDIT, and is preserved
 * for audit purposes even after the response body is updated.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.41
 */
export const interactionModerationActions = pgTable(
  'interaction_moderation_actions',
  {
    id: idColumn(),
    responseId: uuid('response_id')
      .notNull()
      .references(() => interactionResponses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    action: varchar('action', { length: 32 }).notNull(),
    reason: text('reason'),
    previousBody: text('previous_body'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('interaction_moderation_actions_response_created_at_idx').on(
      table.responseId,
      table.createdAt,
    ),
    index('interaction_moderation_actions_user_created_at_idx').on(table.userId, table.createdAt),
    check(
      'interaction_moderation_actions_action_check',
      sql`${table.action} IN ('APPROVE', 'REJECT', 'EDIT', 'ESCALATE')`,
    ),
  ],
);
