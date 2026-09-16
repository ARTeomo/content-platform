/**
 * Errors raised by the authentication package.
 *
 * The error taxonomy is a closed vocabulary. Consumers may branch on the
 * `category` field to decide retry policy, alerting, and audit logging.
 */

export type AuthenticationErrorCategory =
  | 'MISSING_ENVIRONMENT_VARIABLE'
  | 'INVALID_ENCRYPTION_KEY'
  | 'ENCRYPTION_FAILED'
  | 'DECRYPTION_FAILED'
  | 'UNSUPPORTED_CIPHERTEXT_FORMAT'
  | 'CREDENTIAL_NOT_FOUND'
  | 'INVALID_CREDENTIAL_INPUT';

export class AuthenticationError extends Error {
  readonly category: AuthenticationErrorCategory;

  constructor(category: AuthenticationErrorCategory, message: string) {
    super(message);
    this.name = 'AuthenticationError';
    this.category = category;
  }
}
