import type {
  ProviderCredentialRow,
  ProviderCredentialsRepository,
  TransactionManager,
} from '@content-platform/database';
import { AuthenticationError } from '../errors.js';
import type { CredentialEncryptionProvider } from '../encryption/index.js';
import { MetaErrorMapper } from './meta-error-mapper.js';
import type { MetaGraphClient } from './meta-graph-client.js';
import type {
  CredentialHealthReport,
  CredentialValidationResult,
  DecryptedCredential,
  GetCredentialInput,
  InvalidateCredentialInput,
  MetaCredentialScope,
  MetaCredentialStatus,
  MetaCredentialType,
  RotateCredentialInput,
  StoreCredentialInput,
} from './meta-credential-types.js';

export interface MetaCredentialServiceConfig {
  appId: string;
  appSecret: string;
}

/**
 * Orchestrates the Meta credential lifecycle.
 *
 * Responsibilities:
 *   - Encrypt / decrypt via `CredentialEncryptionProvider`
 *   - Persist via `ProviderCredentialsRepository`
 *   - Call Graph API via `MetaGraphClient`
 *   - Categorize errors via `MetaErrorMapper`
 *
 * The service never logs plaintext secrets. The returned
 * `DecryptedCredential.value` must only live for the duration of the
 * caller's operation.
 */
export class MetaCredentialService {
  constructor(
    private readonly txManager: TransactionManager,
    private readonly credentialsRepo: ProviderCredentialsRepository,
    private readonly encryption: CredentialEncryptionProvider,
    private readonly graphClient: MetaGraphClient,
    private readonly config: MetaCredentialServiceConfig,
  ) {}

  /**
   * Read and decrypt a credential.
   *
   * Returns `null` when no row matches the lookup.
   */
  async getCredential(input: GetCredentialInput): Promise<DecryptedCredential | null> {
    const scope: MetaCredentialScope = input.destinationId === null ? 'APP' : 'DESTINATION';

    const row = await this.credentialsRepo.findUnique({
      provider: input.provider,
      credentialType: input.credentialType,
      scope,
      destinationId: input.destinationId,
    });

    if (!row) return null;

    const plaintext = this.encryption.decrypt(
      { ciphertext: row.encryptedValue, keyVersion: row.encryptionKeyVersion },
      {
        provider: row.provider,
        credentialType: row.credentialType,
        destinationId: row.destinationId,
      },
    );

    return {
      id: row.id,
      provider: 'META',
      credentialType: row.credentialType as MetaCredentialType,
      scope: row.scope as MetaCredentialScope,
      destinationId: row.destinationId,
      value: plaintext,
      status: row.status as MetaCredentialStatus,
      expiresAt: row.expiresAt,
      lastValidatedAt: row.lastValidatedAt,
    };
  }

  /**
   * Encrypt and store a credential. Uses the active encryption key.
   *
   * Idempotent on the unique identity
   * `(provider, credential_type, scope, COALESCE(destination_id, '0..0'))`.
   */
  async storeCredential(input: StoreCredentialInput): Promise<ProviderCredentialRow> {
    if (input.plaintextValue.length === 0) {
      throw new AuthenticationError('INVALID_CREDENTIAL_INPUT', 'plaintextValue must not be empty');
    }

    const encrypted = this.encryption.encrypt(input.plaintextValue, {
      provider: 'META',
      credentialType: input.credentialType,
      destinationId: input.destinationId,
    });

    return await this.txManager.run(async (tx) =>
      this.credentialsRepo.upsert(tx, {
        scope: input.scope,
        destinationId: input.destinationId,
        provider: 'META',
        credentialType: input.credentialType,
        encryptedValue: encrypted.ciphertext,
        encryptionKeyVersion: encrypted.keyVersion,
        status: input.status ?? 'UNKNOWN',
        expiresAt: input.expiresAt ?? null,
      }),
    );
  }

  /**
   * Rotate a credential by exchanging the current value for a longer-lived
   * one via the Graph API and persisting the result.
   *
   * Throws if the credential does not exist.
   */
  async rotateCredential(input: RotateCredentialInput): Promise<ProviderCredentialRow> {
    const current = await this.getCredential({
      provider: input.provider,
      credentialType: input.credentialType,
      destinationId: input.destinationId,
    });

    if (!current) {
      throw new AuthenticationError(
        'CREDENTIAL_NOT_FOUND',
        `No ${input.credentialType} credential for destination ${input.destinationId ?? 'APP'}`,
      );
    }

    const exchanged = await this.graphClient.exchangeForLongLivedToken({
      shortLivedToken: current.value,
      appId: this.config.appId,
      appSecret: this.config.appSecret,
    });

    const expiresAt = new Date(Date.now() + exchanged.expiresIn * 1000);

    const encrypted = this.encryption.encrypt(exchanged.accessToken, {
      provider: 'META',
      credentialType: input.credentialType,
      destinationId: input.destinationId,
    });

    await this.txManager.run(async (tx) => {
      await this.credentialsRepo.recordRotation(
        tx,
        current.id,
        encrypted.ciphertext,
        encrypted.keyVersion,
        expiresAt,
        input.reason,
      );
    });

    const updated = await this.credentialsRepo.findUnique({
      provider: input.provider,
      credentialType: input.credentialType,
      scope: input.destinationId === null ? 'APP' : 'DESTINATION',
      destinationId: input.destinationId,
    });

    if (!updated) {
      throw new AuthenticationError(
        'CREDENTIAL_NOT_FOUND',
        'Rotation recorded but the credential row could not be re-read',
      );
    }

    return updated;
  }

  /**
   * Mark a credential as INVALID. No-op when the credential does not exist.
   */
  async invalidateCredential(input: InvalidateCredentialInput): Promise<void> {
    const scope: MetaCredentialScope = input.destinationId === null ? 'APP' : 'DESTINATION';

    const row = await this.credentialsRepo.findUnique({
      provider: input.provider,
      credentialType: input.credentialType,
      scope,
      destinationId: input.destinationId,
    });

    if (!row) return;

    await this.txManager.run(async (tx) => {
      await this.credentialsRepo.markInvalid(tx, row.id, input.reason);
    });
  }

  /**
   * Validate a credential against the Graph API.
   *
   * On success, sets `status = VALID` and updates `last_validated_at`.
   * On authentication or permission errors, sets `status = INVALID`.
   * On transient errors, preserves the existing status but still updates
   * `last_validated_at`.
   */
  async validateCredential(input: GetCredentialInput): Promise<CredentialValidationResult> {
    const credential = await this.getCredential(input);
    const now = new Date();

    if (!credential) {
      return {
        status: 'UNKNOWN',
        checkedAt: now,
        errorCategory: 'CREDENTIAL_NOT_FOUND',
        errorMessage: `No ${input.credentialType} credential for destination ${input.destinationId ?? 'APP'}`,
      };
    }

    try {
      await this.graphClient.validateAccessToken(credential.value);

      await this.txManager.run(async (tx) => {
        await this.credentialsRepo.updateStatus(tx, credential.id, 'VALID', now);
      });

      return { status: 'VALID', checkedAt: now };
    } catch (err) {
      const category = MetaErrorMapper.categorize(err);
      const message = err instanceof Error ? err.message : String(err);

      const newStatus: MetaCredentialStatus =
        category === 'AUTHENTICATION_ERROR' || category === 'PERMISSION_ERROR'
          ? 'INVALID'
          : credential.status;

      await this.txManager.run(async (tx) => {
        if (newStatus === 'INVALID') {
          await this.credentialsRepo.markInvalid(tx, credential.id, `validate_failed: ${category}`);
        } else {
          await this.credentialsRepo.updateStatus(tx, credential.id, newStatus, now);
        }
      });

      return {
        status: newStatus,
        checkedAt: now,
        errorCategory: category,
        errorMessage: message,
      };
    }
  }

  /**
   * Aggregate health report for all credentials of a destination.
   *
   * The overall status is the worst of the individual statuses:
   * INVALID > UNKNOWN > EXPIRING > VALID.
   */
  async healthCheck(destinationId: string): Promise<CredentialHealthReport> {
    const rows = await this.credentialsRepo.findAllForDestination(destinationId);
    const nowMs = Date.now();

    const credentials = rows.map((row) => ({
      credentialType: row.credentialType as MetaCredentialType,
      status: row.status as MetaCredentialStatus,
      expiresAt: row.expiresAt,
      daysUntilExpiry: row.expiresAt
        ? Math.floor((row.expiresAt.getTime() - nowMs) / (1000 * 60 * 60 * 24))
        : null,
    }));

    const overall = computeOverallStatus(credentials.map((c) => c.status));

    return { destinationId, overall, credentials };
  }
}

function computeOverallStatus(statuses: readonly MetaCredentialStatus[]): MetaCredentialStatus {
  if (statuses.length === 0) return 'UNKNOWN';
  if (statuses.includes('INVALID')) return 'INVALID';
  if (statuses.includes('UNKNOWN')) return 'UNKNOWN';
  if (statuses.includes('EXPIRING')) return 'EXPIRING';
  return 'VALID';
}
