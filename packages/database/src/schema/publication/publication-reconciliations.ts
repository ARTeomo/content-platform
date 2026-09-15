import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, nullableTimestampColumn } from '../_common.js';
import { publications } from './publications.js';
import { publicationAttempts } from './publication-attempts.js';

/**
 * Durable investigation of uncertain external publication outcomes.
 *
 * Reconciliation may proceed via a provider-specific mechanism (for
 * example, a Meta Graph API lookup keyed by the external post
 * identifier) or via a push event from the provider. The `result` field
 * captures the outcome category, and `details` carries provider-specific
 * response details.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.27
 * @see DATABASE_SCHEMA_CONTRACT.md §56 (reconciliation)
 */
export const publicationReconciliations = pgTable(
  'publication_reconciliations',
  {
    id: idColumn(),
    publicationId: uuid('publication_id')
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
    attemptId: uuid('attempt_id').references(() => publicationAttempts.id, {
      onDelete: 'set null',
    }),
    status: text('status').notNull(),
    checkedAt: nullableTimestampColumn('checked_at'),
    externalPostId: text('external_post_id'),
    result: text('result'),
    details: jsonb('details').$type<Record<string, unknown>>(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('publication_reconciliations_publication_id_idx').on(table.publicationId),
    index('publication_reconciliations_status_idx').on(table.status),
    check(
      'publication_reconciliations_status_check',
      sql`${table.status} IN ('PUBLISHED', 'RETRY_ELIGIBLE', 'UNKNOWN')`,
    ),
  ],
);
