import type { EncryptionKeySet } from '../env.js';
import {
  CredentialEncryptionProvider,
  type EncryptedValue,
} from './credential-encryption-provider.js';

/**
 * Webhook verify token encryption.
 *
 * Wraps `CredentialEncryptionProvider` with the webhook-specific AAD
 * context. The context is:
 *
 *   provider:       'META'
 *   credentialType: 'WEBHOOK_VERIFY_TOKEN'
 *   destinationId:  <the subscription's destination UUID>
 *
 * This yields the AAD string `META:WEBHOOK_VERIFY_TOKEN:<destinationId>`,
 * which binds each ciphertext to its destination. Copying a ciphertext
 * from one destination to another causes decryption to fail.
 *
 * The provider reuses the AES-256-GCM cipher format from
 * `CredentialEncryptionProvider`: `v1:base64(iv || ciphertext || tag)`.
 */
export class WebhookTokenEncryptionProvider {
  private readonly inner: CredentialEncryptionProvider;

  constructor(keySet: EncryptionKeySet) {
    this.inner = new CredentialEncryptionProvider(keySet);
  }

  /**
   * Encrypt a verify token bound to a destination.
   *
   * Uses the active key version from the key set.
   */
  encrypt(plaintext: string, destinationId: string): EncryptedValue {
    return this.inner.encrypt(plaintext, {
      provider: 'META',
      credentialType: 'WEBHOOK_VERIFY_TOKEN',
      destinationId,
    });
  }

  /**
   * Decrypt a verify token bound to a destination.
   *
   * The `keyVersion` in the `EncryptedValue` selects which key to use,
   * enabling key rotation without a full-table rewrite.
   */
  decrypt(encrypted: EncryptedValue, destinationId: string): string {
    return this.inner.decrypt(encrypted, {
      provider: 'META',
      credentialType: 'WEBHOOK_VERIFY_TOKEN',
      destinationId,
    });
  }

  /**
   * Re-encrypt under the active key version. Used by the key-rotation
   * migration.
   */
  reencrypt(encrypted: EncryptedValue, destinationId: string): EncryptedValue {
    return this.inner.reencrypt(encrypted, {
      provider: 'META',
      credentialType: 'WEBHOOK_VERIFY_TOKEN',
      destinationId,
    });
  }

  /**
   * Constant-time string comparison.
   *
   * The verify token arrives as a query string parameter, which is
   * attacker-controlled. A naive `===` comparison leaks timing
   * information, potentially allowing a byte-by-byte brute force of the
   * verify token.
   */
  safeEqual(a: string, b: string): boolean {
    return this.inner.safeEqual(a, b);
  }

  /**
   * The key version used for new encryptions.
   */
  getActiveKeyVersion(): number {
    return this.inner.getActiveKeyVersion();
  }
}
