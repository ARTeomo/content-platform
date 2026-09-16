import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { AuthenticationError } from '../errors.js';
import type { EncryptionKeySet } from '../env.js';

/**
 * Additional authenticated data that binds a ciphertext to its logical
 * context.
 *
 * The AAD is included in the authentication tag. If a ciphertext is
 * copied to a different (provider, credentialType, destinationId)
 * context, decryption fails — this prevents ciphertext substitution
 * attacks where an attacker with DB write access moves a ciphertext from
 * one destination to another.
 */
export interface EncryptionContext {
  provider: string;
  credentialType: string;
  destinationId: string | null;
}

export interface EncryptedValue {
  /** Format: `v1:base64(iv || ciphertext || tag)`. */
  ciphertext: string;
  /** The key version used to encrypt this value. */
  keyVersion: number;
}

const FORMAT_VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const TAG_LENGTH_BYTES = 16;

function buildAad(context: EncryptionContext): Buffer {
  return Buffer.from(
    `${context.provider}:${context.credentialType}:${context.destinationId ?? 'app'}`,
    'utf8',
  );
}

/**
 * AES-256-GCM encryption provider for provider credentials.
 *
 * ## Format
 *
 * `v1:base64(iv || ciphertext || tag)`
 *
 * The `v1` prefix is the *format version*, distinct from the *key
 * version*. Format version tracks the ciphertext layout; key version
 * tracks the encryption key.
 *
 * ## Key rotation
 *
 * The provider holds multiple keys indexed by version. New encryptions
 * always use `activeVersion`. Decryption uses the key version stored in
 * the row (via `EncryptedValue.keyVersion`). This means rotation does not
 * require a full-table rewrite in a single transaction.
 *
 * ## AAD binding
 *
 * The AAD is `provider:credentialType:destinationId`. See
 * `EncryptionContext`.
 */
export class CredentialEncryptionProvider {
  private readonly keys: Map<number, Buffer>;
  private readonly activeVersion: number;

  constructor(keySet: EncryptionKeySet) {
    this.keys = keySet.keys;
    this.activeVersion = keySet.activeVersion;
  }

  /**
   * The key version used for new encryptions.
   */
  getActiveKeyVersion(): number {
    return this.activeVersion;
  }

  /**
   * Encrypt a plaintext credential value.
   *
   * @param plaintext - The raw secret. Never logged, never persisted.
   * @param context - The logical context this ciphertext is bound to.
   * @returns The encrypted value and the key version used.
   */
  encrypt(plaintext: string, context: EncryptionContext): EncryptedValue {
    const key = this.keys.get(this.activeVersion);
    if (!key) {
      // Defensive: the constructor and loadMetaCredentialKeySet ensure
      // this cannot happen, but the type system does not.
      throw new AuthenticationError(
        'INVALID_ENCRYPTION_KEY',
        `Active key version ${this.activeVersion} is not loaded`,
      );
    }

    const iv = randomBytes(IV_LENGTH_BYTES);
    const aad = buildAad(context);

    let ciphertext: Buffer;
    let tag: Buffer;
    try {
      const cipher = createCipheriv(ALGORITHM, key, iv);
      cipher.setAAD(aad);
      ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      tag = cipher.getAuthTag();
    } catch (err) {
      throw new AuthenticationError(
        'ENCRYPTION_FAILED',
        `Encryption failed: ${(err as Error).message}`,
      );
    }

    const payload = Buffer.concat([iv, ciphertext, tag]);
    return {
      ciphertext: `${FORMAT_VERSION}:${payload.toString('base64')}`,
      keyVersion: this.activeVersion,
    };
  }

  /**
   * Decrypt an encrypted credential value.
   *
   * @param encrypted - The ciphertext and its key version.
   * @param context - The logical context this ciphertext was bound to.
   * @returns The plaintext secret.
   */
  decrypt(encrypted: EncryptedValue, context: EncryptionContext): string {
    const key = this.keys.get(encrypted.keyVersion);
    if (!key) {
      throw new AuthenticationError(
        'INVALID_ENCRYPTION_KEY',
        `Key version ${encrypted.keyVersion} is not loaded`,
      );
    }

    const { version, payload } = parseCiphertext(encrypted.ciphertext);
    if (version !== 1) {
      throw new AuthenticationError(
        'UNSUPPORTED_CIPHERTEXT_FORMAT',
        `Unsupported ciphertext format version: ${version}`,
      );
    }

    if (payload.length < IV_LENGTH_BYTES + TAG_LENGTH_BYTES) {
      throw new AuthenticationError(
        'DECRYPTION_FAILED',
        'Ciphertext payload is too short to contain IV and tag',
      );
    }

    const iv = payload.subarray(0, IV_LENGTH_BYTES);
    const tag = payload.subarray(payload.length - TAG_LENGTH_BYTES);
    const ciphertext = payload.subarray(IV_LENGTH_BYTES, payload.length - TAG_LENGTH_BYTES);
    const aad = buildAad(context);

    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return plaintext.toString('utf8');
    } catch (err) {
      throw new AuthenticationError(
        'DECRYPTION_FAILED',
        `Decryption failed: ${(err as Error).message}. This indicates either a corrupted ciphertext, a wrong key version, or a mismatched context (AAD).`,
      );
    }
  }

  /**
   * Re-encrypt a value under the active key version.
   *
   * Used by the rotation flow. Returns a new `EncryptedValue` even if the
   * incoming value was already at the active version — the caller decides
   * whether to persist the result.
   */
  reencrypt(encrypted: EncryptedValue, context: EncryptionContext): EncryptedValue {
    const plaintext = this.decrypt(encrypted, context);
    return this.encrypt(plaintext, context);
  }

  /**
   * Constant-time comparison helper. Useful for tests and for future
   * credential-type-specific validation that needs to compare two
   * strings without leaking their content via timing.
   */
  safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}

interface ParsedCiphertext {
  version: number;
  payload: Buffer;
}

function parseCiphertext(ciphertext: string): ParsedCiphertext {
  const separator = ciphertext.indexOf(':');
  if (separator === -1) {
    throw new AuthenticationError(
      'UNSUPPORTED_CIPHERTEXT_FORMAT',
      'Ciphertext does not contain a format version prefix',
    );
  }
  const versionTag = ciphertext.slice(0, separator);
  const base64 = ciphertext.slice(separator + 1);

  const versionMatch = /^v(\d+)$/.exec(versionTag);
  if (!versionMatch || !versionMatch[1]) {
    throw new AuthenticationError(
      'UNSUPPORTED_CIPHERTEXT_FORMAT',
      `Invalid format version tag: "${versionTag}"`,
    );
  }
  const version = Number.parseInt(versionMatch[1], 10);

  let payload: Buffer;
  try {
    payload = Buffer.from(base64, 'base64');
  } catch {
    throw new AuthenticationError(
      'UNSUPPORTED_CIPHERTEXT_FORMAT',
      'Ciphertext payload is not valid base64',
    );
  }

  return { version, payload };
}
