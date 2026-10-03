import type { MetaCredentialServiceBundle } from './meta-credential-bridge.js';

export type GetAccessTokenFn = (destinationId: string) => Promise<string>;

export interface BuildGetAccessTokenOptions {
  bundle: MetaCredentialServiceBundle;
  fallbackToken: string | undefined;
  logger: Pick<Console, 'info' | 'warn' | 'error'>;
}

/**
 * Build the `getAccessToken` callback used by every Meta adapter.
 *
 * Resolution order:
 *
 *   1. DB-backed PAGE_ACCESS_TOKEN for the destination, if present
 *      and not marked INVALID.
 *   2. Fallback `META_PAGE_ACCESS_TOKEN` environment variable.
 *      Every fallback use is logged at warn level so operators can
 *      see which destinations still need to be migrated.
 *
 * Throws when neither source yields a token. The adapters map the
 * throw to an AUTHENTICATION_ERROR result.
 */
export function buildGetAccessToken(options: BuildGetAccessTokenOptions): GetAccessTokenFn {
  const { bundle, fallbackToken, logger } = options;
  let fallbackWarned = false;

  return async (destinationId: string): Promise<string> => {
    if (bundle.available && bundle.service) {
      const cred = await bundle.service.getCredential({
        provider: 'META',
        credentialType: 'PAGE_ACCESS_TOKEN',
        destinationId,
      });

      if (cred && cred.status !== 'INVALID') {
        return cred.value;
      }

      if (cred && cred.status === 'INVALID') {
        logger.warn(
          `[credentials] destination ${destinationId} has INVALID PAGE_ACCESS_TOKEN in DB; refusing to use fallback`,
        );
        throw new Error(`PAGE_ACCESS_TOKEN for destination ${destinationId} is marked INVALID`);
      }
    }

    if (fallbackToken) {
      if (!fallbackWarned) {
        logger.warn(
          '[credentials] no DB-backed PAGE_ACCESS_TOKEN available; falling back to META_PAGE_ACCESS_TOKEN environment variable. This bypass is deprecated and will be removed.',
        );
        fallbackWarned = true;
      }
      return fallbackToken;
    }

    throw new Error(
      `No PAGE_ACCESS_TOKEN for destination ${destinationId}: credential service unavailable and META_PAGE_ACCESS_TOKEN is not set`,
    );
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
