export { MetaGraphApiError, MetaErrorMapper, type MetaErrorCategory } from './meta-error-mapper.js';

export {
  HttpMetaGraphClient,
  type ExchangeTokenInput,
  type LongLivedTokenResponse,
  type MetaGraphClient,
  type MetaMeResponse,
  type HttpMetaGraphClientOptions,
} from './meta-graph-client.js';

export {
  MetaCredentialService,
  type MetaCredentialServiceConfig,
} from './meta-credential-service.js';

export {
  type CredentialHealthReport,
  type CredentialValidationResult,
  type DecryptedCredential,
  type GetCredentialInput,
  type InvalidateCredentialInput,
  type MetaCredentialScope,
  type MetaCredentialStatus,
  type MetaCredentialType,
  type RotateCredentialInput,
  type StoreCredentialInput,
} from './meta-credential-types.js';
