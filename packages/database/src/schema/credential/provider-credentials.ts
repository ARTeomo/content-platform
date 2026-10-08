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
 * ## Unique business identity (v1.3.1)
 *
 * Two partial unique indexes enforce the APP and DESTINATION scope
 * rules directly, without a sentinel UUID:
 *
 *   - provider_credentials_app_uq        (provider, credential_type)
 *                                        WHERE scope = 'APP' AND destination_id IS NULL
 *   - provider_credentials_destination_uq (provider, credential_type, destination_id)
 *                                        WHERE scope = 'DESTINATION' AND destination_id IS NOT NULL
 *
 * This expresses the domain rule in the index predicate itself and
 * avoids the collision risk of a sentinel UUID. It replaces the
 * pre-v1.3.1 `provider_credentials_unique` COALESCE expression index,
 * which was dropped by migration `0018`.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.40, §8.3
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
    uniqueIndex('provider_credentials_app_uq')
      .on(table.provider, table.credentialType)
      .where(sql`${table.scope} = 'APP' AND ${table.destinationId} IS NULL`),
    uniqueIndex('provider_credentials_destination_uq')
      .on(table.provider, table.credentialType, table.destinationId)
      .where(sql`${table.scope} = 'DESTINATION' AND ${table.destinationId} IS NOT NULL`),
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
