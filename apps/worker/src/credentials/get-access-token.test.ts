import { describe, expect, it, vi } from 'vitest';
import {
  CredentialResolutionError,
  type CredentialResolutionErrorCategory,
} from '@content-platform/publishers';
import { buildGetAccessToken } from './get-access-token.js';
import type { MetaCredentialServiceBundle } from './meta-credential-bridge.js';
import type { MetaCredentialService } from '@content-platform/authentication';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function bundleUnavailable(reason: string): MetaCredentialServiceBundle {
  return { available: false, unavailableReason: reason };
}

function bundleWith(
  getCredential: MetaCredentialService['getCredential'],
): MetaCredentialServiceBundle {
  return {
    available: true,
    service: { getCredential } as unknown as MetaCredentialService,
  };
}

function credRow(overrides: {
  value: string;
  status: 'VALID' | 'EXPIRING' | 'INVALID' | 'UNKNOWN';
}) {
  return {
    id: 'cred-1',
    provider: 'META' as const,
    credentialType: 'PAGE_ACCESS_TOKEN' as const,
    scope: 'DESTINATION' as const,
    destinationId: 'dest-1',
    value: overrides.value,
    status: overrides.status,
    expiresAt: null,
    lastValidatedAt: null,
  };
}

async function expectThrow(
  fn: () => Promise<unknown>,
  category: CredentialResolutionErrorCategory,
): Promise<void> {
  try {
    await fn();
    throw new Error('expected CredentialResolutionError, got success');
  } catch (err) {
    expect(err).toBeInstanceOf(CredentialResolutionError);
    expect((err as CredentialResolutionError).category).toBe(category);
  }
}

describe('buildGetAccessToken', () => {
  it('throws CREDENTIAL_SERVICE_UNAVAILABLE when bundle is unavailable', async () => {
    const get = buildGetAccessToken({
      bundle: bundleUnavailable('missing env'),
      logger,
    });
    await expectThrow(() => get('dest-1'), 'CREDENTIAL_SERVICE_UNAVAILABLE');
  });

  it('throws CREDENTIAL_NOT_FOUND when no row exists for the destination', async () => {
    const get = buildGetAccessToken({
      bundle: bundleWith(async () => null),
      logger,
    });
    await expectThrow(() => get('dest-1'), 'CREDENTIAL_NOT_FOUND');
  });

  it('throws CREDENTIAL_INVALID when the row is marked INVALID', async () => {
    const get = buildGetAccessToken({
      bundle: bundleWith(async () => credRow({ value: 'x', status: 'INVALID' })),
      logger,
    });
    await expectThrow(() => get('dest-1'), 'CREDENTIAL_INVALID');
  });

  it('returns the value when the credential is VALID', async () => {
    const get = buildGetAccessToken({
      bundle: bundleWith(async () => credRow({ value: 'token-abc', status: 'VALID' })),
      logger,
    });
    await expect(get('dest-1')).resolves.toBe('token-abc');
  });

  it('returns the value when the credential is EXPIRING (not yet invalid)', async () => {
    const get = buildGetAccessToken({
      bundle: bundleWith(async () => credRow({ value: 'token-exp', status: 'EXPIRING' })),
      logger,
    });
    await expect(get('dest-1')).resolves.toBe('token-exp');
  });

  it('returns the value when the credential is UNKNOWN', async () => {
    const get = buildGetAccessToken({
      bundle: bundleWith(async () => credRow({ value: 'token-unk', status: 'UNKNOWN' })),
      logger,
    });
    await expect(get('dest-1')).resolves.toBe('token-unk');
  });
});
