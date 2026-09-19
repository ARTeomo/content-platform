#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, '..', '..', '..', '.env');
const PAGE_ID = process.env.META_PAGE_ID ?? '1287488901121523';
const VERSION = process.env.META_GRAPH_API_VERSION ?? 'v21.0';

const content = readFileSync(ENV_PATH, 'utf8');
const match = content.match(/^META_PAGE_ACCESS_TOKEN=(.*)$/m);
if (!match) {
  console.error('No META_PAGE_ACCESS_TOKEN in .env');
  process.exit(1);
}
const userToken = match[1].trim();
console.log('Current token length:', userToken.length);

const res = await fetch(
  `https://graph.facebook.com/${VERSION}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(userToken)}`,
);
const json = await res.json();
if (json.error) {
  console.error('Graph API error:', json.error.message);
  process.exit(1);
}

const page = (json.data ?? []).find((p) => p.id === PAGE_ID);
if (!page) {
  console.error(`Page ${PAGE_ID} not found in /me/accounts`);
  process.exit(1);
}
if (!page.access_token) {
  console.error('Page access_token missing in response');
  process.exit(1);
}

console.log('Page:', page.name, `(${page.id})`);
console.log('New token length:', page.access_token.length);

writeFileSync(
  ENV_PATH,
  content.replace(/^META_PAGE_ACCESS_TOKEN=.*$/m, `META_PAGE_ACCESS_TOKEN=${page.access_token}`),
  'utf8',
);
console.log('.env updated.');
