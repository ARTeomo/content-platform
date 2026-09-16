import { AuthenticationError } from './errors.js';

/**
 * Load and validate the encryption key material from the process
 * environment.
 *
 * Two separate key sets are used:
 *
 *   - `WEBHOOK_TOKEN_ENCRYPTION_KEY` — for the static webhook verify token.
 *   - `META_CREDENTIAL_ENCRYPTION_KEYS` + `META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION`
 *     — for OAuth-based provider credentials (Page Access Token, App Secret).
 *
 * The two key sets are never shared. A compromise of one must not affect
 * the other.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §4.6
 */

const KEY_LENGTH_BYTES = 32; // AES-256

function decodeBase64Key(name: string, value: string): Buffer {
  let buf: Buffer;
  try {
    buf = Buffer.from(value, 'base64');
  } catch {
    throw new AuthenticationError(
      'INVALID_ENCRYPTION_KEY',
      `Environment variable ${name} is not valid base64`,
    );
  }
  if (buf.length !== KEY_LENGTH_BYTES) {
    throw new AuthenticationError(
      'INVALID_ENCRYPTION_KEY',
      `Environment variable ${name} must decode to ${KEY_LENGTH_BYTES} bytes, got ${buf.length}`,
    );
  }
  return buf;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new AuthenticationError(
      'MISSING_ENVIRONMENT_VARIABLE',
      `Required environment variable ${name} is not set`,
    );
  }
  return value;
}

export interface EncryptionKeySet {
  /** Keys indexed by version number. */
  keys: Map<number, Buffer>;
  /** The version used for new encryptions. */
  activeVersion: number;
}

/**
 * Load the Meta credential encryption key set.
 *
 * Format of `META_CREDENTIAL_ENCRYPTION_KEYS`:
 *
 *   {"1":"<base64-32-bytes>","2":"<base64-32-bytes>"}
 *
 * `META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION` must match one of the keys
 * in the JSON object.
 */
export function loadMetaCredentialKeySet(): EncryptionKeySet {
  const raw = requireEnv('META_CREDENTIAL_ENCRYPTION_KEYS');
  const activeVersionRaw = requireEnv('META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION');

  const activeVersion = Number.parseInt(activeVersionRaw, 10);
  if (!Number.isInteger(activeVersion) || activeVersion <= 0) {
    throw new AuthenticationError(
      'INVALID_ENCRYPTION_KEY',
      `META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION must be a positive integer, got "${activeVersionRaw}"`,
    );
  }

  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(raw) as Record<string, string>;
  } catch {
    throw new AuthenticationError(
      'INVALID_ENCRYPTION_KEY',
      'META_CREDENTIAL_ENCRYPTION_KEYS is not valid JSON',
    );
  }

  const keys = new Map<number, Buffer>();
  for (const [versionStr, keyStr] of Object.entries(parsed)) {
    const version = Number.parseInt(versionStr, 10);
    if (!Number.isInteger(version) || version <= 0) {
      throw new AuthenticationError(
        'INVALID_ENCRYPTION_KEY',
        `Key version "${versionStr}" is not a positive integer`,
      );
    }
    keys.set(version, decodeBase64Key(`META_CREDENTIAL_ENCRYPTION_KEYS[${versionStr}]`, keyStr));
  }

  if (!keys.has(activeVersion)) {
    throw new AuthenticationError(
      'INVALID_ENCRYPTION_KEY',
      `Active version ${activeVersion} is not present in META_CREDENTIAL_ENCRYPTION_KEYS`,
    );
  }

  return { keys, activeVersion };
}
