#!/usr/bin/env node
//
// One-shot script: create a destination and a webhook subscription
// with an encrypted verify token.
//
// Usage (from the repository root):
//   node packages/database/scripts/seed-webhook-subscription.mjs \
//     --page-id 1287488901121523 \
//     --page-name "Content Platform" \
//     --verify-token "content-platform-verify-2026"
//
// Requires DATABASE_URL and one of:
//   - WEBHOOK_TOKEN_ENCRYPTION_KEY (legacy single base64 key)
//   - WEBHOOK_TOKEN_ENCRYPTION_KEYS + WEBHOOK_TOKEN_ENCRYPTION_ACTIVE_VERSION

import { createCipheriv, randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(__dirname, '..', 'package.json'));

const postgres = require('postgres');

const { values } = parseArgs({
  options: {
    'page-id': { type: 'string' },
    'page-name': { type: 'string' },
    'verify-token': { type: 'string' },
  },
});

const pageId = values['page-id'];
const pageName = values['page-name'] ?? 'Content Platform';
const verifyToken = values['verify-token'];

if (!pageId || !verifyToken) {
  console.error('Missing required arguments: --page-id and --verify-token');
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Resolve the encryption key and its version.
//
// The same logic as `loadWebhookTokenKeySet()` in the authentication
// package, replicated here because this script is a standalone Node ESM
// file with no TypeScript imports.
// ---------------------------------------------------------------------------
function resolveEncryptionKey() {
  const jsonRaw = process.env.WEBHOOK_TOKEN_ENCRYPTION_KEYS;
  const singleRaw = process.env.WEBHOOK_TOKEN_ENCRYPTION_KEY;
  const activeVersionRaw = process.env.WEBHOOK_TOKEN_ENCRYPTION_ACTIVE_VERSION ?? '1';

  if (singleRaw && !jsonRaw) {
    return { key: Buffer.from(singleRaw, 'base64'), version: 1 };
  }

  if (!jsonRaw) {
    console.error(
      'Either WEBHOOK_TOKEN_ENCRYPTION_KEYS or WEBHOOK_TOKEN_ENCRYPTION_KEY must be set',
    );
    process.exit(1);
  }

  const activeVersion = Number.parseInt(activeVersionRaw, 10);
  if (!Number.isInteger(activeVersion) || activeVersion <= 0) {
    console.error('WEBHOOK_TOKEN_ENCRYPTION_ACTIVE_VERSION must be a positive integer');
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonRaw);
  } catch {
    console.error('WEBHOOK_TOKEN_ENCRYPTION_KEYS is not valid JSON');
    process.exit(1);
  }

  const keyBase64 = parsed[String(activeVersion)];
  if (!keyBase64) {
    console.error(`Active version ${activeVersion} not present in WEBHOOK_TOKEN_ENCRYPTION_KEYS`);
    process.exit(1);
  }

  return { key: Buffer.from(keyBase64, 'base64'), version: activeVersion };
}

const { key, version: keyVersion } = resolveEncryptionKey();

if (key.length !== 32) {
  console.error(`Encryption key must be 32 bytes, got ${key.length}`);
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 2, prepare: false });

try {
  // 1. Upsert the destination.
  const existingDest = await sql`
    SELECT id FROM destinations WHERE type = 'META' AND external_id = ${pageId}
  `;

  let destinationId;
  if (existingDest[0]) {
    destinationId = existingDest[0].id;
    console.log(`[seed] destination exists: ${destinationId}`);
  } else {
    const created = await sql`
      INSERT INTO destinations (name, type, external_id)
      VALUES (${pageName}, 'META', ${pageId})
      RETURNING id
    `;
    destinationId = created[0].id;
    console.log(`[seed] destination created: ${destinationId}`);
  }

  // 2. Encrypt the verify token.
  //
  // AAD is `META:WEBHOOK_VERIFY_TOKEN:<destinationId>` — must match the
  // `WebhookTokenEncryptionProvider` in @content-platform/authentication.
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`META:WEBHOOK_VERIFY_TOKEN:${destinationId}`, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(verifyToken, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ciphertext = `v1:${Buffer.concat([iv, encrypted, tag]).toString('base64')}`;

  // 3. Upsert the webhook subscription.
  await sql`
    INSERT INTO webhook_subscriptions (
      destination_id, provider, fields, verify_token_encrypted,
      verify_token_key_version, status
    ) VALUES (
      ${destinationId}, 'META', ARRAY['feed', 'mention'],
      ${ciphertext}, ${keyVersion}, 'ACTIVE'
    )
    ON CONFLICT (destination_id, provider)
    DO UPDATE SET
      verify_token_encrypted = EXCLUDED.verify_token_encrypted,
      verify_token_key_version = EXCLUDED.verify_token_key_version,
      fields = EXCLUDED.fields,
      status = EXCLUDED.status,
      updated_at = now()
  `;

  console.log(
    `[seed] subscription ready for destination ${destinationId} (key version ${keyVersion})`,
  );
  console.log(`[seed] verify token (paste into Meta dashboard): ${verifyToken}`);
} finally {
  await sql.end({ timeout: 5 });
}
