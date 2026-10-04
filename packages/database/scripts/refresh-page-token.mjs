#!/usr/bin/env node
//
// v1.3 F5a — Refresh the Page Access Token into provider_credentials.
//
// Reads META_USER_ACCESS_TOKEN (a System User token from Meta Business
// Suite), exchanges it for a Page Access Token via GET /me/accounts,
// encrypts the Page token with the active META_CREDENTIAL_ENCRYPTION_KEYS
// key, and upserts it into provider_credentials.
//
// It does NOT touch .env. The token must live in provider_credentials,
// encrypted at rest.
//
// Usage (from the repository root):
//   export META_USER_ACCESS_TOKEN="EAAG..."
//   export META_PAGE_ID=1287488901121523       # optional
//   node packages/database/scripts/refresh-page-token.mjs
//
// Requires: DATABASE_URL, META_USER_ACCESS_TOKEN,
//           META_CREDENTIAL_ENCRYPTION_KEYS,
//           META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION
// Optional: META_PAGE_ID (default 1287488901121523),
//           META_GRAPH_API_VERSION (default v21.0)

import { createCipheriv, randomBytes } from 'node:crypto';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
const USER_TOKEN = process.env.META_USER_ACCESS_TOKEN;
const PAGE_ID = process.env.META_PAGE_ID ?? '1287488901121523';
const VERSION = process.env.META_GRAPH_API_VERSION ?? 'v21.0';
const PROVIDER = 'META';
const CREDENTIAL_TYPE = 'PAGE_ACCESS_TOKEN';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

if (!DATABASE_URL) die('DATABASE_URL is not set');
if (!USER_TOKEN) die('META_USER_ACCESS_TOKEN is not set');

function resolveActiveKey() {
  const jsonRaw = process.env.META_CREDENTIAL_ENCRYPTION_KEYS;
  const activeRaw = process.env.META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION;
  if (!jsonRaw) die('META_CREDENTIAL_ENCRYPTION_KEYS is not set');
  if (!activeRaw) die('META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION is not set');

  const activeVersion = Number.parseInt(activeRaw, 10);
  if (!Number.isInteger(activeVersion) || activeVersion <= 0) {
    die('META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION must be a positive integer');
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonRaw);
  } catch {
    die('META_CREDENTIAL_ENCRYPTION_KEYS is not valid JSON');
  }

  const b64 = parsed[String(activeVersion)];
  if (!b64) die(`active version ${activeVersion} not present in key set`);

  const key = Buffer.from(b64, 'base64');
  if (key.length !== KEY_BYTES) {
    die(`active key must decode to ${KEY_BYTES} bytes, got ${key.length}`);
  }
  return { key, activeVersion };
}

function encryptPageToken(plaintext, destinationId, key) {
  const iv = randomBytes(IV_BYTES);
  const aad = Buffer.from(`${PROVIDER}:${CREDENTIAL_TYPE}:${destinationId}`, 'utf8');
  const cipher = createCipheriv(ALGO, key, iv);
  cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${Buffer.concat([iv, ct, tag]).toString('base64')}`;
}

const { key, activeVersion } = resolveActiveKey();

const url = new URL(`https://graph.facebook.com/${VERSION}/me/accounts`);
url.searchParams.set('fields', 'id,name,access_token');
url.searchParams.set('access_token', USER_TOKEN);

const res = await fetch(url);
const json = await res.json();
if (json.error) die(`Graph API error: ${json.error.message}`);

const page = (json.data ?? []).find((p) => p.id === PAGE_ID);
if (!page) die(`Page ${PAGE_ID} not found in /me/accounts`);
if (!page.access_token) die('Page access_token missing in response');

console.log(`[refresh] Page: ${page.name} (${page.id})`);
console.log(`[refresh] New token length: ${page.access_token.length}`);

const sql = postgres(DATABASE_URL, { max: 1 });
try {
  const rows = await sql`
    SELECT id FROM destinations
    WHERE type = ${PROVIDER} AND external_id = ${PAGE_ID}
    LIMIT 1
  `;
  if (rows.length === 0) die(`no destination with type=${PROVIDER} external_id=${PAGE_ID}`);
  const destinationId = rows[0].id;

  const ciphertext = encryptPageToken(page.access_token, destinationId, key);

  const upserted = await sql`
    INSERT INTO provider_credentials (
      scope, destination_id, provider, credential_type,
      encrypted_value, encryption_key_version, status, expires_at
    ) VALUES (
      'DESTINATION', ${destinationId}, ${PROVIDER}, ${CREDENTIAL_TYPE},
      ${ciphertext}, ${activeVersion}, 'VALID', NULL
    )
    ON CONFLICT (
      provider, credential_type, scope,
      COALESCE(destination_id, '00000000-0000-0000-0000-000000000000'::uuid)
    )
    DO UPDATE SET
      encrypted_value        = EXCLUDED.encrypted_value,
      encryption_key_version = EXCLUDED.encryption_key_version,
      status                 = EXCLUDED.status,
      expires_at             = EXCLUDED.expires_at,
      updated_at             = now()
    RETURNING id
  `;
  console.log(`[refresh] provider_credentials.id: ${upserted[0].id}`);
  console.log(`[refresh] destination_id: ${destinationId}`);
  console.log(`[refresh] key_version: ${activeVersion}`);
  console.log('[refresh] OK');
} finally {
  await sql.end({ timeout: 5 });
}
