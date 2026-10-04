#!/usr/bin/env node
//
// v1.3 D-013 — Create a destination, a webhook_endpoint, and a
// webhook_subscription with an encrypted verify token.
//
// Usage (from the repository root):
//   node packages/database/scripts/seed-webhook-subscription.mjs \
//     --page-id 1287488901121523 \
//     --page-name "Content Platform" \
//     --endpoint-name "content-platform-app" \
//     --verify-token "content-platform-verify-2026"
//
// Requires DATABASE_URL and one of:
//   - WEBHOOK_TOKEN_ENCRYPTION_KEY (legacy single base64 key, v1 = 1)
//   - WEBHOOK_TOKEN_ENCRYPTION_KEYS + WEBHOOK_TOKEN_ENCRYPTION_ACTIVE_VERSION

import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
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
    'endpoint-name': { type: 'string' },
    'verify-token': { type: 'string' },
  },
});

const pageId = values['page-id'];
const pageName = values['page-name'] ?? 'Content Platform';
const endpointName = values['endpoint-name'] ?? 'app-meta';
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

function encryptForEndpoint(plaintext, endpointId) {
  const iv = randomBytes(12);
  const aad = Buffer.from(`META:WEBHOOK_VERIFY_TOKEN:${endpointId}`, 'utf8');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${Buffer.concat([iv, ct, tag]).toString('base64')}`;
}

const sql = postgres(databaseUrl, { max: 2, prepare: false });

try {
  // 1. Destination
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

  // 2. Endpoint — find by (provider, name) or create
  const existingEp = await sql`
    SELECT id FROM webhook_endpoints
    WHERE provider = 'META' AND name = ${endpointName}
  `;
  let endpointId;
  if (existingEp[0]) {
    endpointId = existingEp[0].id;
    const ciphertext = encryptForEndpoint(verifyToken, endpointId);
    await sql`
      UPDATE webhook_endpoints
      SET verify_token_encrypted = ${ciphertext},
          verify_token_key_version = ${keyVersion},
          last_rotated_at = now(),
          updated_at = now()
      WHERE id = ${endpointId}
    `;
    console.log(`[seed] endpoint exists, token rotated: ${endpointId}`);
  } else {
    endpointId = randomUUID();
    const ciphertext = encryptForEndpoint(verifyToken, endpointId);
    await sql`
      INSERT INTO webhook_endpoints (
        id, provider, name, verify_token_encrypted,
        verify_token_key_version, status
      ) VALUES (
        ${endpointId}, 'META', ${endpointName},
        ${ciphertext}, ${keyVersion}, 'ACTIVE'
      )
    `;
    console.log(`[seed] endpoint created: ${endpointId}`);
  }

  // 3. Subscription
  await sql`
    INSERT INTO webhook_subscriptions (
      destination_id, endpoint_id, provider, fields, status
    ) VALUES (
      ${destinationId}, ${endpointId}, 'META',
      ARRAY['feed', 'mention'], 'ACTIVE'
    )
    ON CONFLICT (destination_id, provider)
    DO UPDATE SET
      endpoint_id = EXCLUDED.endpoint_id,
      fields = EXCLUDED.fields,
      status = EXCLUDED.status,
      updated_at = now()
  `;

  console.log(
    `[seed] subscription ready for destination ${destinationId} (endpoint ${endpointId})`,
  );
  console.log(`[seed] verify token (paste into Meta dashboard): ${verifyToken}`);
} finally {
  await sql.end({ timeout: 5 });
}
