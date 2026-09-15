import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn } from '../_common.js';
import { contentItems } from '../content/content-items.js';
import { publicationCandidates } from '../publication/publication-candidates.js';
import { users } from '../identity/users.js';

/**
 * Durable moderation decision history for publication candidates.
 *
 * A moderation action is an immutable record. Multiple actions may exist
 * for the same candidate (for example, EDIT then APPROVE). The
 * `candidate_id` is nullable because a moderator may act on the content
 * item before a candidate is finalized.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.24
 */
export const moderationActions = pgTable(
  'moderation_actions',
  {
    id: idColumn(),
    contentId: uuid('content_id')
      .notNull()
      .references(() => contentItems.id, { onDelete: 'cascade' }),
    candidateId: uuid('candidate_id').references(() => publicationCandidates.id, {
      onDelete: 'set null',
    }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
    reason: text('reason'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('moderation_actions_content_id_created_at_idx').on(table.contentId, table.createdAt),
    index('moderation_actions_candidate_id_idx').on(table.candidateId),
    index('moderation_actions_user_id_created_at_idx').on(table.userId, table.createdAt),
    check(
      'moderation_actions_action_check',
      sql`${table.action} IN ('APPROVE', 'REJECT', 'EDIT', 'ARCHIVE')`,
    ),
  ],
);
