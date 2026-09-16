import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CredentialEncryptionProvider } from './credential-encryption-provider.js';
import { AuthenticationError } from '../errors.js';

function makeProvider(activeVersion = 1): {
  provider: CredentialEncryptionProvider;
  keys: Map<number, Buffer>;
} {
  const keys = new Map<number, Buffer>();
  keys.set(1, randomBytes(32));
  keys.set(2, randomBytes(32));
  return { provider: new CredentialEncryptionProvider({ keys, activeVersion }), keys };
}

const ctx = {
  provider: 'META',
  credentialType: 'PAGE_ACCESS_TOKEN',
  destinationId: '00000000-0000-0000-0000-000000000001',
};

describe('CredentialEncryptionProvider', () => {
  it('encrypts and decrypts a value', () => {
    const { provider } = makeProvider();
    const encrypted = provider.encrypt('EAAG...secret-token', ctx);
    expect(encrypted.ciphertext.startsWith('v1:')).toBe(true);
    expect(encrypted.keyVersion).toBe(1);

    const plaintext = provider.decrypt(encrypted, ctx);
    expect(plaintext).toBe('EAAG...secret-token');
  });

  it('uses the active key version for new encryptions', () => {
    const { provider } = makeProvider(2);
    const encrypted = provider.encrypt('value', ctx);
    expect(encrypted.keyVersion).toBe(2);

    const plaintext = provider.decrypt(encrypted, ctx);
    expect(plaintext).toBe('value');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const { provider } = makeProvider();
    const a = provider.encrypt('same', ctx);
    const b = provider.encrypt('same', ctx);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('fails to decrypt when the AAD context does not match', () => {
    const { provider } = makeProvider();
    const encrypted = provider.encrypt('secret', ctx);

    const wrongDestination = {
      ...ctx,
      destinationId: '00000000-0000-0000-0000-000000000002',
    };

    expect(() => provider.decrypt(encrypted, wrongDestination)).toThrowError(AuthenticationError);
  });

  it('fails to decrypt when the credential type in the AAD does not match', () => {
    const { provider } = makeProvider();
    const encrypted = provider.encrypt('secret', ctx);

    const wrongType = { ...ctx, credentialType: 'APP_SECRET' };

    expect(() => provider.decrypt(encrypted, wrongType)).toThrowError(AuthenticationError);
  });

  it('supports APP scope with destinationId = null', () => {
    const { provider } = makeProvider();
    const appCtx = {
      provider: 'META',
      credentialType: 'APP_SECRET',
      destinationId: null,
    };

    const encrypted = provider.encrypt('app-secret-value', appCtx);
    const plaintext = provider.decrypt(encrypted, appCtx);
    expect(plaintext).toBe('app-secret-value');
  });

  it('re-encrypts to the active key version', () => {
    const keys = new Map<number, Buffer>();
    keys.set(1, randomBytes(32));
    keys.set(2, randomBytes(32));

    const v1Provider = new CredentialEncryptionProvider({ keys, activeVersion: 1 });
    const encryptedV1 = v1Provider.encrypt('value', ctx);
    expect(encryptedV1.keyVersion).toBe(1);

    const v2Provider = new CredentialEncryptionProvider({ keys, activeVersion: 2 });
    const reencrypted = v2Provider.reencrypt(encryptedV1, ctx);
    expect(reencrypted.keyVersion).toBe(2);

    const plaintext = v2Provider.decrypt(reencrypted, ctx);
    expect(plaintext).toBe('value');
  });

  it('rejects an unsupported ciphertext format version', () => {
    const { provider } = makeProvider();
    const bogus = { ciphertext: 'v99:AAAA', keyVersion: 1 };
    expect(() => provider.decrypt(bogus, ctx)).toThrowError(AuthenticationError);
  });

  it('rejects a ciphertext without a version prefix', () => {
    const { provider } = makeProvider();
    const bogus = { ciphertext: 'AAAA', keyVersion: 1 };
    expect(() => provider.decrypt(bogus, ctx)).toThrowError(AuthenticationError);
  });

  it('rejects decryption when the key version is not loaded', () => {
    const { provider } = makeProvider();
    const encrypted = provider.encrypt('value', ctx);
    const missingKey = { ...encrypted, keyVersion: 99 };
    expect(() => provider.decrypt(missingKey, ctx)).toThrowError(AuthenticationError);
  });

  it('safeEqual returns true for identical strings', () => {
    const { provider } = makeProvider();
    expect(provider.safeEqual('abc', 'abc')).toBe(true);
  });

  it('safeEqual returns false for different strings', () => {
    const { provider } = makeProvider();
    expect(provider.safeEqual('abc', 'abd')).toBe(false);
    expect(provider.safeEqual('abc', 'abcd')).toBe(false);
  });
});
