/**
 * Domain types for Meta provider credentials.
 *
 * These types are the service-level API. They are decoupled from the
 * database schema (`ProviderCredentialRow`) and from the Graph API wire
 * format so that the service layer is stable even if either changes.
 */

export type MetaCredentialType = 'APP_SECRET' | 'PAGE_ACCESS_TOKEN';
export type MetaCredentialScope = 'APP' | 'DESTINATION';
export type MetaCredentialStatus = 'VALID' | 'EXPIRING' | 'INVALID' | 'UNKNOWN';

export interface GetCredentialInput {
  provider: 'META';
  credentialType: MetaCredentialType;
  /** `null` selects APP scope. */
  destinationId: string | null;
}

/**
 * A decrypted credential. The `value` field contains the plaintext
 * secret and must never be logged, cached, or persisted.
 */
export interface DecryptedCredential {
  id: string;
  provider: 'META';
  credentialType: MetaCredentialType;
  scope: MetaCredentialScope;
  destinationId: string | null;
  value: string;
  status: MetaCredentialStatus;
  expiresAt: Date | null;
  lastValidatedAt: Date | null;
}

export interface StoreCredentialInput {
  scope: MetaCredentialScope;
  destinationId: string | null;
  credentialType: MetaCredentialType;
  /** The plaintext secret. Never logged. */
  plaintextValue: string;
  expiresAt?: Date | null;
  status?: MetaCredentialStatus;
}

export interface RotateCredentialInput {
  provider: 'META';
  credentialType: MetaCredentialType;
  destinationId: string | null;
  /** Free-form reason recorded on the credential row. */
  reason: string;
}

export interface InvalidateCredentialInput {
  provider: 'META';
  credentialType: MetaCredentialType;
  destinationId: string | null;
  reason: string;
}

export interface CredentialValidationResult {
  status: MetaCredentialStatus;
  checkedAt: Date;
  errorCategory?: string;
  errorMessage?: string;
}

export interface CredentialHealthReport {
  destinationId: string;
  overall: MetaCredentialStatus;
  credentials: ReadonlyArray<{
    credentialType: MetaCredentialType;
    status: MetaCredentialStatus;
    expiresAt: Date | null;
    daysUntilExpiry: number | null;
  }>;
}
