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
// Requires DATABASE_URL and WEBHOOK_TOKEN_ENCRYPTION_KEY in the environment.

import { createCipheriv, randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(__dirname, '..', 'package.json'));

// postgres is a dependency of packages/database; resolve it via that package.json.
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
const keyBase64 = process.env.WEBHOOK_TOKEN_ENCRYPTION_KEY;

if (!databaseUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
if (!keyBase64) {
  console.error('WEBHOOK_TOKEN_ENCRYPTION_KEY is not set');
  process.exit(1);
}

const key = Buffer.from(keyBase64, 'base64');
if (key.length !== 32) {
  console.error('WEBHOOK_TOKEN_ENCRYPTION_KEY must be 32 bytes base64');
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

  // 2. Encrypt the verify token (AES-256-GCM, AAD = META:<destinationId>).
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`META:${destinationId}`, 'utf8'));
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
      ${ciphertext}, 1, 'ACTIVE'
    )
    ON CONFLICT (destination_id, provider)
    DO UPDATE SET
      verify_token_encrypted = EXCLUDED.verify_token_encrypted,
      verify_token_key_version = EXCLUDED.verify_token_key_version,
      fields = EXCLUDED.fields,
      status = EXCLUDED.status,
      updated_at = now()
  `;

  console.log(`[seed] subscription ready for destination ${destinationId}`);
  console.log(`[seed] verify token (paste into Meta dashboard): ${verifyToken}`);
} finally {
  await sql.end({ timeout: 5 });
}
