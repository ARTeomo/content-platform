#!/usr/bin/env node
//
// Phase 20.0 — Meta credential preflight.
//
// Validates META_PAGE_ACCESS_TOKEN against the real Meta Graph API
// before any publication record is created.
//
// Checks:
//   1. Token presence in the environment.
//   2. GET /me                — token identity.
//   3. GET /me/accounts       — Pages accessible by this token.
//   4. Target Page confirmation (if META_PAGE_ID is set).
//   5. GET /me/permissions    — granted scopes.
//
// Usage:
//   export META_PAGE_ACCESS_TOKEN=...
//   export META_GRAPH_API_VERSION=v21.0
//   export META_PAGE_ID=1287488901121523
//   node scripts/meta-preflight.mjs

const token = process.env.META_PAGE_ACCESS_TOKEN;
const version = process.env.META_GRAPH_API_VERSION ?? 'v21.0';
const targetPageId = process.env.META_PAGE_ID;

if (!token) {
  console.error('ERROR: META_PAGE_ACCESS_TOKEN is not set.');
  console.error('Add it to .env and export it, or set it inline for this run.');
  process.exit(1);
}

const base = `https://graph.facebook.com/${version}`;

async function call(path, params = {}) {
  const url = new URL(`${base}${path}`);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url);
  const body = await res.json();
  return { ok: res.ok, status: res.status, body };
}

function line(label, value) {
  console.log(`  ${label.padEnd(28)}${value}`);
}

(async () => {
  console.log('=== Phase 20.0 — Meta preflight ===');
  console.log('');
  console.log(`Graph API version:        ${version}`);
  console.log(`Token (first 12 chars):   ${token.slice(0, 12)}...`);
  console.log('');

  // 1. /me — token identity
  console.log('[1/4] GET /me');
  const me = await call('/me', { fields: 'id,name' });
  if (!me.ok) {
    console.error('  FAILED:', JSON.stringify(me.body));
    process.exit(1);
  }
  line('id:', me.body.id);
  line('name:', me.body.name ?? '(none)');
  console.log('  OK');
  console.log('');

  // 2. /me/accounts — Pages accessible
  console.log('[2/4] GET /me/accounts');
  const accounts = await call('/me/accounts', { fields: 'id,name,username,category' });
  if (!accounts.ok) {
    console.error('  FAILED:', JSON.stringify(accounts.body));
    process.exit(1);
  }
  const pages = accounts.body.data ?? [];
  line('pages accessible:', pages.length);
  for (const page of pages) {
    const marker = targetPageId && page.id === targetPageId ? '  ← target' : '';
    console.log(`    - ${page.id}  ${page.name}  (${page.username ?? 'no username'})${marker}`);
  }
  console.log('');

  // 3. Target Page confirmation
  if (targetPageId) {
    console.log(`[3/4] Target Page ${targetPageId}`);
    const found = pages.find((p) => p.id === targetPageId);
    if (found) {
      line('status:', 'FOUND');
      line('name:', found.name);
      line('username:', found.username ?? '(none)');
    } else {
      line('status:', 'NOT FOUND in /me/accounts');
      console.error('  The target Page is not accessible by this token.');
      process.exit(1);
    }
    console.log('');
  } else {
    console.log('[3/4] Target Page check skipped (META_PAGE_ID not set)');
    console.log('');
  }

  // 4. /me/permissions — granted scopes
  console.log('[4/4] GET /me/permissions');
  const perms = await call('/me/permissions');
  if (!perms.ok) {
    console.error('  FAILED:', JSON.stringify(perms.body));
    process.exit(1);
  }
  const granted = (perms.body.data ?? []).filter((p) => p.status === 'granted');
  const declined = (perms.body.data ?? []).filter((p) => p.status !== 'granted');

  const required = [
    'pages_manage_posts',
    'pages_manage_engagement',
    'pages_read_engagement',
    'pages_show_list',
  ];

  line('granted:', granted.length);
  for (const p of granted) {
    console.log(`    + ${p.permission}`);
  }
  if (declined.length > 0) {
    line('declined/expired:', declined.length);
    for (const p of declined) {
      console.log(`    - ${p.permission} (${p.status})`);
    }
  }
  console.log('');
  console.log('Required scopes check:');
  let allRequiredPresent = true;
  for (const r of required) {
    const present = granted.some((p) => p.permission === r);
    if (present) {
      console.log(`  + ${r}`);
    } else {
      console.log(`  - ${r}  MISSING`);
      allRequiredPresent = false;
    }
  }
  console.log('');

  if (!allRequiredPresent) {
    console.error('PREFLIGHT FAILED: one or more required scopes are missing.');
    process.exit(1);
  }

  console.log('PREFLIGHT PASSED.');
})();
