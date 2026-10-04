#!/usr/bin/env node
//
// v1.3 D-013c — Backfill webhook_endpoints from legacy subscriptions.
//
// For every ACTIVE webhook_subscriptions row with endpoint_id IS NULL:
//   1. Decrypt verify_token_encrypted using the v1.1/v1.2 AAD
//      (META:WEBHOOK_VERIFY_TOKEN:<destination_id>).
//   2. Find or create one webhook_endpoints row per (provider, token)
//      group. In practice, one App-level endpoint per provider.
//   3. Re-encrypt the token under the v1.3 AAD
//      (META:WEBHOOK_VERIFY_TOKEN:<endpoint_id>).
//   4. Set webhook_subscriptions.endpoint_id.
//
// Idempotent: re-running skips rows whose endpoint_id is already set.
//
// Must run AFTER migration 0016 and BEFORE migration 0017.
//
// Usage:
//   node packages/database/scripts/backfill-webhook-endpoints.mjs [--dry-run]
//
// Requires: DATABASE_URL, WEBHOOK_TOKEN_ENCRYPTION_KEYS,
//           WEBHOOK_TOKEN_ENCRYPTION_ACTIVE_VERSION

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.argv.includes('--dry-run');
const PROVIDER = 'META';
const CREDENTIAL_TYPE = 'WEBHOOK_VERIFY_TOKEN';
const FORMAT_V1 = 'v1';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

if (!DATABASE_URL) die('DATABASE_URL is not set');

function loadKeys() {
  const jsonRaw = process.env.WEBHOOK_TOKEN_ENCRYPTION_KEYS;
  const singleRaw = process.env.WEBHOOK_TOKEN_ENCRYPTION_KEY;
  const activeRaw = process.env.WEBHOOK_TOKEN_ENCRYPTION_ACTIVE_VERSION ?? '1';

  if (singleRaw && !jsonRaw) {
    const key = Buffer.from(singleRaw, 'base64');
    if (key.length !== KEY_BYTES) die('legacy key must decode to 32 bytes');
    return { keys: new Map([[1, key]]), activeVersion: 1 };
  }
  if (!jsonRaw) die('WEBHOOK_TOKEN_ENCRYPTION_KEYS is not set');

  let parsed;
  try {
    parsed = JSON.parse(jsonRaw);
  } catch {
    die('WEBHOOK_TOKEN_ENCRYPTION_KEYS is not valid JSON');
  }
  const activeVersion = Number.parseInt(activeRaw, 10);
  const keys = new Map();
  for (const [v, b64] of Object.entries(parsed)) {
    const version = Number.parseInt(v, 10);
    if (!Number.isInteger(version) || version <= 0) die(`invalid key version "${v}"`);
    const buf = Buffer.from(b64, 'base64');
    if (buf.length !== KEY_BYTES) die(`key ${v} must decode to 32 bytes`);
    keys.set(version, buf);
  }
  if (!keys.has(activeVersion)) die(`active version ${activeVersion} not in key set`);
  return { keys, activeVersion };
}

const { keys, activeVersion } = loadKeys();

function aad(context) {
  return Buffer.from(`${PROVIDER}:${CREDENTIAL_TYPE}:${context}`, 'utf8');
}

function decrypt(ciphertext, keyVersion, destinationId) {
  const key = keys.get(keyVersion);
  if (!key) throw new Error(`key version ${keyVersion} not loaded`);
  const sep = ciphertext.indexOf(':');
  if (sep === -1) throw new Error('ciphertext has no format prefix');
  const payload = Buffer.from(ciphertext.slice(sep + 1), 'base64');
  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(payload.length - TAG_BYTES);
  const ct = payload.subarray(IV_BYTES, payload.length - TAG_BYTES);
  const d = createDecipheriv(ALGO, key, iv);
  d.setAAD(aad(destinationId));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

function encrypt(plaintext, endpointId) {
  const key = keys.get(activeVersion);
  const iv = randomBytes(IV_BYTES);
  const c = createCipheriv(ALGO, key, iv);
  c.setAAD(aad(endpointId));
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return {
    ciphertext: `${FORMAT_V1}:${Buffer.concat([iv, ct, tag]).toString('base64')}`,
    keyVersion: activeVersion,
  };
}

const sql = postgres(DATABASE_URL, { max: 2 });

try {
  const subscriptions = await sql`
    SELECT id, destination_id, provider, verify_token_encrypted, verify_token_key_version
    FROM webhook_subscriptions
    WHERE status = 'ACTIVE' AND endpoint_id IS NULL
    ORDER BY created_at ASC
  `;

  console.log(`[backfill] subscriptions needing endpoint_id: ${subscriptions.length}`);
  if (subscriptions.length === 0) {
    console.log('[backfill] nothing to do');
    process.exit(0);
  }

  // Group subscriptions by (provider, decrypted token).
  const groups = new Map(); // key: `${provider}:${sha256(token)}` -> { provider, token, subs: [] }
  for (const sub of subscriptions) {
    let token;
    try {
      token = decrypt(sub.verify_token_encrypted, sub.verify_token_key_version, sub.destination_id);
    } catch (err) {
      die(
        `cannot decrypt verify_token for subscription ${sub.id} ` +
          `(destination ${sub.destination_id}): ${err.message}`,
      );
    }
    const groupKey = `${sub.provider}:${token}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { provider: sub.provider, token, subs: [] });
    }
    groups.get(groupKey).subs.push(sub);
  }

  console.log(`[backfill] distinct (provider, token) groups: ${groups.size}`);

  if (DRY_RUN) {
    for (const [key, group] of groups) {
      console.log(
        `[backfill] DRY RUN: provider=${group.provider} ` +
          `subscriptions=${group.subs.map((s) => s.id).join(', ')}`,
      );
    }
    process.exit(0);
  }

  for (const [key, group] of groups) {
    const endpointId = randomUUID();
    const name = `app-${group.provider.toLowerCase()}-${endpointId.slice(0, 8)}`;
    const encrypted = encrypt(group.token, endpointId);

    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO webhook_endpoints (
          id, provider, name, verify_token_encrypted,
          verify_token_key_version, status
        ) VALUES (
          ${endpointId}, ${group.provider}, ${name},
          ${encrypted.ciphertext}, ${encrypted.keyVersion}, 'ACTIVE'
        )
      `;
      for (const sub of group.subs) {
        await tx`
          UPDATE webhook_subscriptions
          SET endpoint_id = ${endpointId}, updated_at = now()
          WHERE id = ${sub.id}
        `;
      }
    });
    console.log(
      `[backfill] endpoint ${endpointId} created; ` + `${group.subs.length} subscription(s) linked`,
    );
  }

  const [{ c: remaining }] = await sql`
    SELECT COUNT(*)::int AS c FROM webhook_subscriptions
    WHERE status = 'ACTIVE' AND endpoint_id IS NULL
  `;
  console.log(`[backfill] remaining unlinked active subscriptions: ${remaining}`);
  if (remaining !== 0) die('backfill did not complete; do not run 0017');
  console.log('[backfill] OK');
} finally {
  await sql.end({ timeout: 5 });
}
