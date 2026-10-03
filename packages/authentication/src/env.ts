import { AuthenticationError } from './errors.js';

/**
 * Load and validate encryption key material from the process
 * environment.
 *
 * Two separate key sets are used:
 *
 *   - `WEBHOOK_TOKEN_ENCRYPTION_KEY` / `WEBHOOK_TOKEN_ENCRYPTION_KEYS`
 *     — for the static webhook verify token.
 *   - `META_CREDENTIAL_ENCRYPTION_KEYS` + `META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION`
 *     — for OAuth-based provider credentials (Page Access Token, App Secret).
 *
 * The two key sets are never shared. A compromise of one must not affect
 * the other.
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

function parseActiveVersion(name: string, raw: string): number {
  const version = Number.parseInt(raw, 10);
  if (!Number.isInteger(version) || version <= 0) {
    throw new AuthenticationError(
      'INVALID_ENCRYPTION_KEY',
      `${name} must be a positive integer, got "${raw}"`,
    );
  }
  return version;
}

/**
 * Parse a JSON object of the form `{"1":"<base64>","2":"<base64>"}`
 * into a Map keyed by version number.
 */
function parseVersionedKeyJson(name: string, raw: string): Map<number, Buffer> {
  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(raw) as Record<string, string>;
  } catch {
    throw new AuthenticationError('INVALID_ENCRYPTION_KEY', `${name} is not valid JSON`);
  }

  const keys = new Map<number, Buffer>();
  for (const [versionStr, keyStr] of Object.entries(parsed)) {
    const version = Number.parseInt(versionStr, 10);
    if (!Number.isInteger(version) || version <= 0) {
      throw new AuthenticationError(
        'INVALID_ENCRYPTION_KEY',
        `Key version "${versionStr}" in ${name} is not a positive integer`,
      );
    }
    keys.set(version, decodeBase64Key(`${name}[${versionStr}]`, keyStr));
  }
  return keys;
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
  const jsonRaw = requireEnv('META_CREDENTIAL_ENCRYPTION_KEYS');
  const activeVersionRaw = requireEnv('META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION');

  const activeVersion = parseActiveVersion(
    'META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION',
    activeVersionRaw,
  );
  const keys = parseVersionedKeyJson('META_CREDENTIAL_ENCRYPTION_KEYS', jsonRaw);

  if (!keys.has(activeVersion)) {
    throw new AuthenticationError(
      'INVALID_ENCRYPTION_KEY',
      `Active version ${activeVersion} is not present in META_CREDENTIAL_ENCRYPTION_KEYS`,
    );
  }

  return { keys, activeVersion };
}

/**
 * Load the webhook verify token encryption key set.
 *
 * Two accepted formats:
 *
 *   1. Legacy single key (no rotation):
 *        WEBHOOK_TOKEN_ENCRYPTION_KEY=<base64-32-bytes>
 *      Treated as version 1.
 *
 *   2. Versioned key set (supports rotation):
 *        WEBHOOK_TOKEN_ENCRYPTION_KEYS={"1":"<base64>","2":"<base64>"}
 *        WEBHOOK_TOKEN_ENCRYPTION_ACTIVE_VERSION=1
 *
 * When both are set, the versioned format wins. This lets an operator
 * migrate a running system by adding the versioned env vars without
 * touching the legacy one until the migration is complete.
 */
export function loadWebhookTokenKeySet(): EncryptionKeySet {
  const jsonRaw = process.env.WEBHOOK_TOKEN_ENCRYPTION_KEYS;
  const singleRaw = process.env.WEBHOOK_TOKEN_ENCRYPTION_KEY;
  const activeVersionRaw = process.env.WEBHOOK_TOKEN_ENCRYPTION_ACTIVE_VERSION;

  // Legacy single key: no rotation possible, version 1.
  if (singleRaw && !jsonRaw) {
    const key = decodeBase64Key('WEBHOOK_TOKEN_ENCRYPTION_KEY', singleRaw);
    const keys = new Map<number, Buffer>();
    keys.set(1, key);
    return { keys, activeVersion: 1 };
  }

  if (!jsonRaw) {
    throw new AuthenticationError(
      'MISSING_ENVIRONMENT_VARIABLE',
      'Either WEBHOOK_TOKEN_ENCRYPTION_KEYS or WEBHOOK_TOKEN_ENCRYPTION_KEY must be set',
    );
  }

  const activeVersion = parseActiveVersion(
    'WEBHOOK_TOKEN_ENCRYPTION_ACTIVE_VERSION',
    activeVersionRaw ?? '1',
  );
  const keys = parseVersionedKeyJson('WEBHOOK_TOKEN_ENCRYPTION_KEYS', jsonRaw);

  if (!keys.has(activeVersion)) {
    throw new AuthenticationError(
      'INVALID_ENCRYPTION_KEY',
      `Active version ${activeVersion} is not present in WEBHOOK_TOKEN_ENCRYPTION_KEYS`,
    );
  }

  return { keys, activeVersion };
}
