/**
 * Typed error raised by the worker's `getAccessToken` callback when a
 * PAGE_ACCESS_TOKEN cannot be resolved from `provider_credentials`.
 *
 * The `category` lets the adapters distinguish "there is no credential
 * to invalidate" from "the existing credential is marked INVALID" so
 * that `shouldInvalidateCredential` is only set when it would actually
 * change something.
 */
export type CredentialResolutionErrorCategory =
  'CREDENTIAL_SERVICE_UNAVAILABLE' | 'CREDENTIAL_NOT_FOUND' | 'CREDENTIAL_INVALID';

export class CredentialResolutionError extends Error {
  readonly category: CredentialResolutionErrorCategory;

  constructor(category: CredentialResolutionErrorCategory, message: string) {
    super(message);
    this.name = 'CredentialResolutionError';
    this.category = category;
  }
}
