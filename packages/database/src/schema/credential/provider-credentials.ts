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

/**
 * Encrypted storage of provider authentication material with lifecycle
 * tracking.
 *
 * The plaintext credential is never persisted, logged, audited, cached
 * beyond its in-memory operation lifetime, or exposed outside the
 * MetaCredentialService.
 *
 * ## Encryption
 *
 * - Algorithm: AES-256-GCM.
 * - Key material supplied via META_CREDENTIAL_ENCRYPTION_KEYS and
 *   META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION environment variables.
 * - AAD binds the ciphertext to (provider, credential_type, destination_id).
 * - `encryption_key_version` is stored per row so key rotation does not
 *   require a full-table rewrite in a single transaction.
 *
 * ## Unique business identity
 *
 * The uniqueness is on (provider, credential_type, scope, destination_id),
 * with COALESCE to make APP-scope rows (destination_id = NULL) collide
 * with each other for the same (provider, credential_type).
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.38
 * @see ADR-006 (encryption at rest — deferred to Phase 15 docs)
 */
export const providerCredentials = pgTable(
  'provider_credentials',
  {
    id: idColumn(),
    scope: varchar('scope', { length: 32 }).notNull(),
    destinationId: uuid('destination_id').references(() => destinations.id, {
      onDelete: 'cascade',
    }),
    provider: varchar('provider', { length: 32 }).notNull(),
    credentialType: varchar('credential_type', { length: 64 }).notNull(),
    encryptedValue: text('encrypted_value').notNull(),
    encryptionKeyVersion: integer('encryption_key_version').notNull(),
    status: varchar('status', { length: 32 }).notNull().default('UNKNOWN'),
    expiresAt: nullableTimestampColumn('expires_at'),
    lastValidatedAt: nullableTimestampColumn('last_validated_at'),
    lastRotationAt: nullableTimestampColumn('last_rotation_at'),
    rotationReason: text('rotation_reason'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex('provider_credentials_unique').on(
      table.provider,
      table.credentialType,
      table.scope,
      sql`COALESCE(${table.destinationId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    index('provider_credentials_status_idx').on(table.status),
    index('provider_credentials_expires_at_idx').on(table.expiresAt),
    check('provider_credentials_scope_check', sql`${table.scope} IN ('APP', 'DESTINATION')`),
    check(
      'provider_credentials_status_check',
      sql`${table.status} IN ('VALID', 'EXPIRING', 'INVALID', 'UNKNOWN')`,
    ),
    check('provider_credentials_key_version_check', sql`${table.encryptionKeyVersion} > 0`),
    check(
      'provider_credentials_scope_destination_check',
      sql`(${table.scope} = 'APP' AND ${table.destinationId} IS NULL) OR (${table.scope} = 'DESTINATION' AND ${table.destinationId} IS NOT NULL)`,
    ),
  ],
);
