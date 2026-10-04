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
import { webhookEndpoints } from './webhook-endpoints.js';

/**
 * Technical subscription configuration for an inbound webhook.
 *
 * A subscription belongs to a destination (Page) and represents one
 * provider-side webhook subscription. It is the inbound analogue of
 * `source_endpoints`: a destination may own multiple subscriptions, and
 * each subscription carries its own verification secret and lifecycle.
 *
 * The `verify_token_encrypted` column stores the App-level verify token
 * encrypted with WEBHOOK_TOKEN_ENCRYPTION_KEY. In v1.2 the token is
 * duplicated per subscription; v1.3 will move it to a `webhook_endpoints`
 * table (see D-013).
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.34
 */
export const webhookSubscriptions = pgTable(
  'webhook_subscriptions',
  {
    id: idColumn(),
    destinationId: uuid('destination_id')
      .notNull()
      .references(() => destinations.id, { onDelete: 'cascade' }),
    /**
     * The owning webhook endpoint. Nullable during the v1.3 EXPAND phase;
     * made NOT NULL by migration 0017 after the backfill script has run.
     */
    endpointId: uuid('endpoint_id').references(() => webhookEndpoints.id, {
      onDelete: 'restrict',
    }),
    provider: varchar('provider', { length: 32 }).notNull(),
    fields: text('fields').array().notNull(),
    verifyTokenEncrypted: text('verify_token_encrypted').notNull(),
    verifyTokenKeyVersion: integer('verify_token_key_version').notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    lastVerifiedAt: nullableTimestampColumn('last_verified_at'),
    lastRotatedAt: nullableTimestampColumn('last_rotated_at'),
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
    check('webhook_subscriptions_key_version_check', sql`${table.verifyTokenKeyVersion} > 0`),
    check(
      'webhook_subscriptions_fields_nonempty_check',
      sql`array_length(${table.fields}, 1) IS NOT NULL`,
    ),
  ],
);
