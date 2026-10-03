import {
  CredentialEncryptionProvider,
  HttpMetaGraphClient,
  MetaCredentialService,
} from '@content-platform/authentication';
import {
  ProviderCredentialsRepository,
  TransactionManager,
  type Database,
} from '@content-platform/database';
import type { WorkerConfig } from '../config.js';

export interface MetaCredentialServiceBundle {
  /**
   * Present when `available === true`. Absent when the worker is
   * running in degraded mode (credential service unavailable). Callers
   * MUST guard with `if (bundle.available && bundle.service)` before
   * using.
   */
  service?: MetaCredentialService;
  /** True when the service was successfully constructed. */
  available: boolean;
  /** Reason the service is unavailable, for logging. */
  unavailableReason?: string;
}

/**
 * Construct a `MetaCredentialService` from the worker's environment
 * configuration.
 *
 * The service requires:
 *   - META_CREDENTIAL_ENCRYPTION_KEYS (JSON object)
 *   - META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION
 *   - META_APP_ID
 *   - META_APP_SECRET
 *
 * When any of these are missing, `available: false` is returned and
 * the caller must decide how to proceed (typically: fall back to
 * `META_PAGE_ACCESS_TOKEN` with a deprecation warning).
 *
 * This factory never throws — unavailability is signalled via the
 * return value so the worker can boot into a degraded but functional
 * mode during the credential migration window.
 */
export function buildMetaCredentialService(
  db: Database,
  config: WorkerConfig,
): MetaCredentialServiceBundle {
  const missing: string[] = [];
  if (!config.metaCredentialEncryptionKeys) missing.push('META_CREDENTIAL_ENCRYPTION_KEYS');
  if (config.metaCredentialEncryptionActiveVersion === undefined) {
    missing.push('META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION');
  }
  if (!config.metaAppId) missing.push('META_APP_ID');
  if (!config.metaAppSecret) missing.push('META_APP_SECRET');

  if (missing.length > 0) {
    return {
      available: false,
      unavailableReason: `missing environment variables: ${missing.join(', ')}`,
    };
  }

  const keysMap = new Map<number, Buffer>();
  for (const [versionStr, base64] of Object.entries(config.metaCredentialEncryptionKeys!)) {
    const version = Number.parseInt(versionStr, 10);
    if (!Number.isInteger(version) || version <= 0) {
      return {
        available: false,
        unavailableReason: `invalid key version "${versionStr}" in META_CREDENTIAL_ENCRYPTION_KEYS`,
      };
    }
    keysMap.set(version, Buffer.from(base64, 'base64'));
  }

  const activeVersion = config.metaCredentialEncryptionActiveVersion!;
  if (!keysMap.has(activeVersion)) {
    return {
      available: false,
      unavailableReason: `active version ${activeVersion} not present in META_CREDENTIAL_ENCRYPTION_KEYS`,
    };
  }

  const encryption = new CredentialEncryptionProvider({
    keys: keysMap,
    activeVersion,
  });

  const graphClient = new HttpMetaGraphClient({
    apiVersion: config.metaGraphApiVersion,
  });

  const service = new MetaCredentialService(
    new TransactionManager(db),
    new ProviderCredentialsRepository(db),
    encryption,
    graphClient,
    {
      appId: config.metaAppId!,
      appSecret: config.metaAppSecret!,
    },
  );

  return { service, available: true };
}
