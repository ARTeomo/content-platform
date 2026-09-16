import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { providerCredentials } from '../schema/credential/provider-credentials.js';
import type { Database, Transaction } from '../transaction/transaction-manager.js';

type ProviderCredentialRow = typeof providerCredentials.$inferSelect;

export type CredentialScope = 'APP' | 'DESTINATION';
export type CredentialStatus = 'VALID' | 'EXPIRING' | 'INVALID' | 'UNKNOWN';

export interface ProviderCredentialInput {
  scope: CredentialScope;
  destinationId: string | null;
  provider: string;
  credentialType: string;
  /** The ciphertext (format `v1:base64(...)`). */
  encryptedValue: string;
  encryptionKeyVersion: number;
  status?: CredentialStatus;
  expiresAt?: Date | null;
}

export interface ProviderCredentialLookup {
  provider: string;
  credentialType: string;
  scope: CredentialScope;
  destinationId: string | null;
}

/**
 * Repository for encrypted provider credentials.
 *
 * The repository deals with the ciphertext and its key version as plain
 * values. Encryption and decryption are handled by
 * `@content-platform/authentication`. The `provider_credentials` table
 * is the durable system of record; this repository is the only supported
 * writer.
 *
 * ## Unique identity
 *
 * The uniqueness is `(provider, credential_type, scope, COALESCE(destination_id, '0..0'))`.
 * The COALESCE is required because PostgreSQL treats NULL as distinct in
 * unique constraints — without it, multiple APP-scope rows could exist
 * for the same provider and credential type.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.38
 */
export class ProviderCredentialsRepository {
  constructor(private readonly db: Database) {}

  /**
   * Insert a new credential, or update the existing row when a row with
   * the same unique identity already exists.
   *
   * The upsert matches the functional unique index using an explicit
   * `COALESCE` in the `ON CONFLICT` clause. Drizzle's `onConflictDoUpdate`
   * does not support functional targets, so this method uses raw SQL.
   *
   * ## Two-step pattern
   *
   * The raw SQL only returns `id`. A subsequent `SELECT` via the Drizzle
   * query builder produces the full row with correctly typed columns
   * (`Date` for `timestamptz`, etc.). Without this, columns returned by
   * the raw `RETURNING` clause would be plain strings because postgres.js
   * does not apply its OID-based parsers to aliased columns of a raw
   * query.
   */
  async upsert(tx: Transaction, input: ProviderCredentialInput): Promise<ProviderCredentialRow> {
    const rows = (await tx.execute(sql`
      INSERT INTO provider_credentials (
        scope,
        destination_id,
        provider,
        credential_type,
        encrypted_value,
        encryption_key_version,
        status,
        expires_at
      )
      VALUES (
        ${input.scope},
        ${input.destinationId},
        ${input.provider},
        ${input.credentialType},
        ${input.encryptedValue},
        ${input.encryptionKeyVersion},
        ${input.status ?? 'UNKNOWN'},
        ${input.expiresAt ? input.expiresAt.toISOString() : null}::timestamptz
      )
      ON CONFLICT (
        provider,
        credential_type,
        scope,
        COALESCE(destination_id, '00000000-0000-0000-0000-000000000000'::uuid)
      )
      DO UPDATE SET
        encrypted_value        = EXCLUDED.encrypted_value,
        encryption_key_version = EXCLUDED.encryption_key_version,
        status                 = EXCLUDED.status,
        expires_at             = EXCLUDED.expires_at,
        updated_at             = now()
      RETURNING id
    `)) as unknown as Array<{ id: string }>;

    const first = rows[0];
    if (!first) {
      throw new Error('Provider credentials upsert returned no rows');
    }

    const [row] = await tx
      .select()
      .from(providerCredentials)
      .where(eq(providerCredentials.id, first.id))
      .limit(1);

    if (!row) {
      throw new Error(
        `Provider credentials upsert returned id ${first.id} but the subsequent select found no row`,
      );
    }

    return row;
  }

  /**
   * Find the credential row matching the unique identity.
   */
  async findUnique(lookup: ProviderCredentialLookup): Promise<ProviderCredentialRow | undefined> {
    const destinationPredicate =
      lookup.destinationId === null
        ? isNull(providerCredentials.destinationId)
        : eq(providerCredentials.destinationId, lookup.destinationId);

    const [row] = await this.db
      .select()
      .from(providerCredentials)
      .where(
        and(
          eq(providerCredentials.provider, lookup.provider),
          eq(providerCredentials.credentialType, lookup.credentialType),
          eq(providerCredentials.scope, lookup.scope),
          destinationPredicate,
        ),
      )
      .limit(1);
    return row;
  }

  /**
   * Find all credentials for a destination (DESTINATION scope only).
   */
  async findAllForDestination(destinationId: string): Promise<ProviderCredentialRow[]> {
    return await this.db
      .select()
      .from(providerCredentials)
      .where(eq(providerCredentials.destinationId, destinationId))
      .orderBy(asc(providerCredentials.credentialType));
  }

  /**
   * Update the status and last-validated timestamp.
   *
   * Used by the health checker after a successful or failed validation.
   */
  async updateStatus(
    tx: Transaction,
    id: string,
    status: CredentialStatus,
    validatedAt: Date,
  ): Promise<void> {
    await tx
      .update(providerCredentials)
      .set({
        status,
        lastValidatedAt: validatedAt,
        updatedAt: new Date(),
      })
      .where(eq(providerCredentials.id, id));
  }

  /**
   * Record a rotation: replace the ciphertext and key version, update the
   * expiry, and stamp the rotation metadata.
   *
   * `status` is set to VALID because a successful rotation produces a
   * valid credential.
   */
  async recordRotation(
    tx: Transaction,
    id: string,
    newEncryptedValue: string,
    newKeyVersion: number,
    newExpiresAt: Date | null,
    reason: string,
  ): Promise<void> {
    const now = new Date();
    await tx
      .update(providerCredentials)
      .set({
        encryptedValue: newEncryptedValue,
        encryptionKeyVersion: newKeyVersion,
        expiresAt: newExpiresAt,
        status: 'VALID',
        lastRotationAt: now,
        rotationReason: reason,
        updatedAt: now,
      })
      .where(eq(providerCredentials.id, id));
  }

  /**
   * Mark a credential as INVALID and record the reason.
   *
   * Used when a Graph API call returns 401 or 403.
   */
  async markInvalid(tx: Transaction, id: string, reason: string): Promise<void> {
    await tx
      .update(providerCredentials)
      .set({
        status: 'INVALID',
        rotationReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(providerCredentials.id, id));
  }

  /**
   * Find all PAGE_ACCESS_TOKEN credentials that expire within the given
   * number of days and are still VALID or EXPIRING.
   *
   * Used by the credential refresh scheduler.
   */
  async findExpiringWithinDays(days: number): Promise<ProviderCredentialRow[]> {
    const threshold = sql`now() + interval '${sql.raw(String(days))} days'`;

    return await this.db
      .select()
      .from(providerCredentials)
      .where(
        and(
          eq(providerCredentials.credentialType, 'PAGE_ACCESS_TOKEN'),
          or(eq(providerCredentials.status, 'VALID'), eq(providerCredentials.status, 'EXPIRING')),
          lt(providerCredentials.expiresAt, threshold),
        ),
      )
      .orderBy(asc(providerCredentials.expiresAt));
  }

  /**
   * Find all credentials still using an older encryption key version.
   *
   * Used by the key-rotation migration to re-encrypt rows.
   */
  async findByKeyVersionBelow(activeVersion: number): Promise<ProviderCredentialRow[]> {
    return await this.db
      .select()
      .from(providerCredentials)
      .where(lt(providerCredentials.encryptionKeyVersion, activeVersion))
      .orderBy(asc(providerCredentials.encryptionKeyVersion));
  }
}
