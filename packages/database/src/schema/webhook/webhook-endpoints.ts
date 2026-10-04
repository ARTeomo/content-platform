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

/**
 * App-level webhook configuration aggregate that owns the verify token.
 *
 * A `webhook_endpoints` row represents one App-level webhook configuration
 * for a given provider. All `webhook_subscriptions` rows for that provider
 * reference this endpoint, so the App-level verify token is defined once
 * and rotated once.
 *
 * Added in v1.3 (D-013). See DATABASE_SCHEMA_CONTRACT.md §5.45.
 *
 * ## AAD binding
 *
 * `verify_token_encrypted` is bound to the endpoint id:
 *
 *     META:WEBHOOK_VERIFY_TOKEN:<endpoint_id>
 *
 * This replaces the v1.1/v1.2 destination-scoped AAD. The backfill script
 * `backfill-webhook-endpoints.mjs` (D-013c) re-encrypts every active
 * subscription's verify token under the new AAD before migration `0017`.
 */
export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: idColumn(),
    provider: varchar('provider', { length: 32 }).notNull(),
    name: text('name').notNull(),
    verifyTokenEncrypted: text('verify_token_encrypted').notNull(),
    verifyTokenKeyVersion: integer('verify_token_key_version').notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    lastVerifiedAt: nullableTimestampColumn('last_verified_at'),
    lastRotatedAt: nullableTimestampColumn('last_rotated_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex('webhook_endpoints_provider_name_uq').on(table.provider, table.name),
    index('webhook_endpoints_status_idx').on(table.status),
    check(
      'webhook_endpoints_status_check',
      sql`${table.status} IN ('ACTIVE', 'PAUSED', 'DISABLED')`,
    ),
    check('webhook_endpoints_key_version_check', sql`${table.verifyTokenKeyVersion} > 0`),
  ],
);

export type WebhookEndpointRow = typeof webhookEndpoints.$inferSelect;
export type WebhookEndpointInsert = typeof webhookEndpoints.$inferInsert;
