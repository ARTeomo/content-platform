import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, nullableTimestampColumn, updatedAtColumn } from '../_common.js';
import { destinations } from '../publication/destinations.js';
import { externalInteractions } from '../webhook/external-interactions.js';

/**
 * Durable intent to publish an outbound response to an external
 * interaction.
 *
 * ## State machine
 *
 *   DRAFT ──> MODERATION_REQUIRED ──> APPROVED ──> SCHEDULED ──> RESPONDED
 *     │                │                   │
 *     │                └──> REJECTED       └──> FAILED
 *     │
 *     └──> AUTO_RESPOND ──────────────────────────> RESPONDED
 *
 * Terminal statuses: RESPONDED, REJECTED, FAILED.
 *
 * Reconciliation states (UNKNOWN, RECONCILIATION) cover the case where
 * the external provider did not return a definitive outcome. See
 * `interaction_response_reconciliations` and DATABASE_SCHEMA_CONTRACT.md
 * §56.1.
 *
 * ## Uniqueness
 *
 * One response per interaction in DB v1. Multi-response threads are a
 * deferred decision (D-008).
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.39, §9.3
 */
export const interactionResponses = pgTable(
  'interaction_responses',
  {
    id: idColumn(),
    interactionId: uuid('interaction_id')
      .notNull()
      .references(() => externalInteractions.id, { onDelete: 'cascade' }),
    destinationId: uuid('destination_id')
      .notNull()
      .references(() => destinations.id, { onDelete: 'set null' }),
    templateId: text('template_id'),
    templateVersion: integer('template_version').notNull().default(1),
    body: text('body'),
    status: varchar('status', { length: 32 }).notNull().default('DRAFT'),
    scheduledAt: nullableTimestampColumn('scheduled_at'),
    respondedAt: nullableTimestampColumn('responded_at'),
    externalResponseId: text('external_response_id'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex('interaction_responses_interaction_id_uq').on(table.interactionId),
    index('interaction_responses_status_scheduled_at_idx').on(table.status, table.scheduledAt),
    index('interaction_responses_destination_status_idx').on(table.destinationId, table.status),
    index('interaction_responses_external_response_id_idx').on(table.externalResponseId),
    check(
      'interaction_responses_status_check',
      sql`${table.status} IN ('DRAFT', 'AUTO_RESPOND', 'MODERATION_REQUIRED', 'APPROVED', 'REJECTED', 'EDITED', 'SCHEDULED', 'QUEUED', 'IN_PROGRESS', 'RESPONDED', 'RETRY', 'FAILED', 'CANCELLED', 'UNKNOWN', 'RECONCILIATION')`,
    ),
    check('interaction_responses_template_version_check', sql`${table.templateVersion} >= 1`),
  ],
);
