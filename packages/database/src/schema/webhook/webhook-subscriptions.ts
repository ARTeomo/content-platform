import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, nullableTimestampColumn, updatedAtColumn } from '../_common.js';
import { destinations } from '../publication/destinations.js';
import { webhookEndpoints } from './webhook-endpoints.js';

/**
 * Technical subscription configuration for an inbound webhook.
 *
 * A subscription belongs to a destination (Page) and represents one
 * provider-side webhook subscription. It is the inbound analogue of
 * `source_endpoints`: a destination may own multiple subscriptions, and
 * each subscription carries its own lifecycle.
 *
 * ## v1.3.1 target state
 *
 * The App-level verify token is owned by `webhook_endpoints` (D-013).
 * This table references the endpoint via `endpoint_id` and does not
 * carry its own verify-token columns or `last_rotated_at`.
 *
 * The legacy `verify_token_encrypted`, `verify_token_key_version`, and
 * `last_rotated_at` columns were dropped by migrations `0017` and `0018`.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.35
 */
export const webhookSubscriptions = pgTable(
  'webhook_subscriptions',
  {
    id: idColumn(),
    destinationId: uuid('destination_id')
      .notNull()
      .references(() => destinations.id, { onDelete: 'cascade' }),
    /**
     * The owning webhook endpoint. NOT NULL after v1.3 CONTRACT (0017).
     */
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'restrict' }),
    provider: varchar('provider', { length: 32 }).notNull(),
    fields: text('fields').array().notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    lastVerifiedAt: nullableTimestampColumn('last_verified_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex('webhook_subscriptions_destination_provider_uq').on(
      table.destinationId,
      table.provider,
    ),
    index('webhook_subscriptions_status_idx').on(table.status),
    index('webhook_subscriptions_endpoint_id_idx').on(table.endpointId),
    check(
      'webhook_subscriptions_status_check',
      sql`${table.status} IN ('ACTIVE', 'PAUSED', 'DISABLED')`,
    ),
    check(
      'webhook_subscriptions_fields_nonempty_check',
      sql`array_length(${table.fields}, 1) IS NOT NULL`,
    ),
  ],
);
