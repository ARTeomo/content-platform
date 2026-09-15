import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, nullableTimestampColumn } from '../_common.js';
import { interactionResponses } from './interaction-responses.js';
import { interactionResponseAttempts } from './interaction-response-attempts.js';

/**
 * Durable investigation of uncertain outbound response outcomes.
 *
 * Two reconciliation paths:
 *
 * - **Push** — the platform's own response reappears as a feed webhook
 *   event and is matched by (destination_id, external_response_id). This
 *   is the preferred path because it is a natural consequence of the
 *   two-way integration.
 *
 * - **Pull** — a scheduled worker queries the provider for the response
 *   state. This is a bounded fallback.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.42
 * @see DATABASE_SCHEMA_CONTRACT.md §11 (reconciliation in the Technical Spec)
 */
export const interactionResponseReconciliations = pgTable(
  'interaction_response_reconciliations',
  {
    id: idColumn(),
    responseId: uuid('response_id')
      .notNull()
      .references(() => interactionResponses.id, { onDelete: 'cascade' }),
    attemptId: uuid('attempt_id').references(() => interactionResponseAttempts.id, {
      onDelete: 'set null',
    }),
    status: varchar('status', { length: 32 }).notNull(),
    checkedAt: nullableTimestampColumn('checked_at'),
    externalResponseId: text('external_response_id'),
    details: jsonb('details').$type<Record<string, unknown>>(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('interaction_response_reconciliations_response_id_idx').on(table.responseId),
    index('interaction_response_reconciliations_status_idx').on(table.status),
    check(
      'interaction_response_reconciliations_status_check',
      sql`${table.status} IN ('RESPONDED', 'RETRY_ELIGIBLE', 'UNKNOWN')`,
    ),
  ],
);
