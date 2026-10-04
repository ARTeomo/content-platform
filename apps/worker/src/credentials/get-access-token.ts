import { CredentialResolutionError } from '@content-platform/publishers';
import type { MetaCredentialServiceBundle } from './meta-credential-bridge.js';

export type GetAccessTokenFn = (destinationId: string) => Promise<string>;

export interface BuildGetAccessTokenOptions {
  bundle: MetaCredentialServiceBundle;
  logger: Pick<Console, 'info' | 'warn' | 'error'>;
}

/**
 * Build the `getAccessToken` callback used by every Meta adapter.
 *
 * Resolution path (fail-closed):
 *
 *   1. The DB-backed PAGE_ACCESS_TOKEN for the destination, if present
 *      and not marked INVALID.
 *   2. Otherwise, throw a `CredentialResolutionError`.
 *
 * There is no environment-variable fallback. The
 * `META_PAGE_ACCESS_TOKEN` bypass was removed in v1.3 F5a: the token
 * must live in `provider_credentials`, encrypted at rest, and be
 * produced by `refresh-page-token.mjs`.
 *
 * The thrown error carries a category so that the adapters can
 * distinguish "no credential exists" from "the credential is marked
 * INVALID" and set `shouldInvalidateCredential` accordingly.
 */
export function buildGetAccessToken(options: BuildGetAccessTokenOptions): GetAccessTokenFn {
  const { bundle, logger } = options;

  return async (destinationId: string): Promise<string> => {
    if (!bundle.available || !bundle.service) {
      const reason = bundle.unavailableReason ?? 'credential service unavailable';
      logger.error(`[credentials] cannot resolve token for ${destinationId}: ${reason}`);
      throw new CredentialResolutionError(
        'CREDENTIAL_SERVICE_UNAVAILABLE',
        `Credential service unavailable for destination ${destinationId}: ${reason}`,
      );
    }

    const cred = await bundle.service.getCredential({
      provider: 'META',
      credentialType: 'PAGE_ACCESS_TOKEN',
      destinationId,
    });

    if (!cred) {
      logger.warn(`[credentials] no DB-backed PAGE_ACCESS_TOKEN for destination ${destinationId}`);
      throw new CredentialResolutionError(
        'CREDENTIAL_NOT_FOUND',
        `No PAGE_ACCESS_TOKEN for destination ${destinationId}`,
      );
    }

    if (cred.status === 'INVALID') {
      logger.warn(`[credentials] destination ${destinationId} has INVALID PAGE_ACCESS_TOKEN in DB`);
      throw new CredentialResolutionError(
        'CREDENTIAL_INVALID',
        `PAGE_ACCESS_TOKEN for destination ${destinationId} is marked INVALID`,
      );
    }

    return cred.value;
  };
}

/**
 * Invalidate a PAGE_ACCESS_TOKEN for a destination.
 *
 * Called by the publish/respond workers when an adapter returns
 * `shouldInvalidateCredential: true`. Best-effort: failures are
 * logged but never propagate, so a failed invalidation cannot mask
 * the original publish/respond outcome.
 */
export async function invalidatePageAccessToken(
  bundle: MetaCredentialServiceBundle,
  destinationId: string,
  reason: string,
  logger: Pick<Console, 'info' | 'warn' | 'error'>,
): Promise<void> {
  if (!bundle.available || !bundle.service) {
    logger.warn(
      `[credentials] cannot invalidate PAGE_ACCESS_TOKEN for ${destinationId}: credential service unavailable`,
    );
    return;
  }

  try {
    await bundle.service.invalidateCredential({
      provider: 'META',
      credentialType: 'PAGE_ACCESS_TOKEN',
      destinationId,
      reason,
    });
    logger.warn(`[credentials] PAGE_ACCESS_TOKEN for ${destinationId} marked INVALID (${reason})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      `[credentials] failed to invalidate PAGE_ACCESS_TOKEN for ${destinationId}: ${msg}`,
    );
  }
}
