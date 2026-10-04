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
  /**
   * Encrypt a verify token bound to an endpoint (v1.3 AAD).
   *
   * The AAD is `META:WEBHOOK_VERIFY_TOKEN:<endpoint_id>`. The two forms
   * (destination-scoped v1.1/v1.2 and endpoint-scoped v1.3) are
   * structurally identical; they differ only in the UUID's referent.
   * The UUID spaces are disjoint, so no collision is possible.
   */
  encryptForEndpoint(plaintext: string, endpointId: string): EncryptedValue {
    return this.inner.encrypt(plaintext, {
      provider: 'META',
      credentialType: 'WEBHOOK_VERIFY_TOKEN',
      destinationId: endpointId,
    });
  }

  decryptForEndpoint(encrypted: EncryptedValue, endpointId: string): string {
    return this.inner.decrypt(encrypted, {
      provider: 'META',
      credentialType: 'WEBHOOK_VERIFY_TOKEN',
      destinationId: endpointId,
    });
  }

  reencryptForEndpoint(encrypted: EncryptedValue, endpointId: string): EncryptedValue {
    return this.inner.reencrypt(encrypted, {
      provider: 'META',
      credentialType: 'WEBHOOK_VERIFY_TOKEN',
      destinationId: endpointId,
    });
  }

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
