import { sql } from 'drizzle-orm';
import {
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
import { createdAtColumn, idColumn, updatedAtColumn } from '../_common.js';
import { destinations } from '../publication/destinations.js';
import { webhookEvents } from './webhook-events.js';

/**
 * Materialized inbound interaction derived from a webhook event.
 *
 * This is the inbound domain's independent business entity. It carries
 * its own identity and references content lifecycle entities only loosely
 * and optionally via nullable foreign keys.
 *
 * `publication_id` is a plain nullable UUID in Phase 4. The FK to
 * `publications` is added in Phase 5 when that table is created.
 *
 * Soft deletion (verb = "remove") is represented in `raw_metadata` and
 * does not physically delete the row.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.37
 */
export const externalInteractions = pgTable(
  'external_interactions',
  {
    id: idColumn(),
    webhookEventId: uuid('webhook_event_id').references(() => webhookEvents.id, {
      onDelete: 'set null',
    }),
    destinationId: uuid('destination_id').references(() => destinations.id, {
      onDelete: 'set null',
    }),
    publicationId: uuid('publication_id'),
    interactionType: varchar('interaction_type', { length: 32 }).notNull(),
    externalInteractionId: text('external_interaction_id').notNull(),
    parentExternalId: text('parent_external_id'),
    actorExternalId: text('actor_external_id'),
    actorDisplayName: text('actor_display_name'),
    content: text('content'),
    permalink: text('permalink'),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    rawMetadata: jsonb('raw_metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex('external_interactions_type_external_id_uq').on(
      table.interactionType,
      table.externalInteractionId,
    ),
    index('external_interactions_publication_occurred_at_idx').on(
      table.publicationId,
      table.occurredAt,
    ),
    index('external_interactions_destination_occurred_at_idx').on(
      table.destinationId,
      table.occurredAt,
    ),
    index('external_interactions_type_occurred_at_idx').on(table.interactionType, table.occurredAt),
    check(
      'external_interactions_type_check',
      sql`${table.interactionType} IN ('COMMENT', 'REACTION', 'MENTION')`,
    ),
  ],
);
