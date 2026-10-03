#!/usr/bin/env node
//
// Manually enqueue a `system.rebuild` job.
//
// Usage (from the repository root):
//   export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)"
//   node packages/database/scripts/trigger-system-rebuild.mjs
//   node packages/database/scripts/trigger-system-rebuild.mjs --scope webhook_events
//
// The job will be picked up by the running worker's outbox dispatcher
// and executed by the SystemRebuildWorker.

import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(__dirname, '..', 'package.json'));
const postgres = require('postgres');

const { values } = parseArgs({
  options: {
    scope: { type: 'string', default: 'all' },
  },
});

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set.');
  process.exit(1);
}

const ALLOWED_SCOPES = ['all', 'webhook_events', 'publications', 'interaction_responses'];
if (!ALLOWED_SCOPES.includes(values.scope)) {
  console.error(`ERROR: --scope must be one of: ${ALLOWED_SCOPES.join(', ')}`);
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });

const ts = Date.now();
const jobId = `system.rebuild:${ts}`;
const payload = values.scope === 'all' ? {} : { scope: values.scope };

try {
  await sql`
    INSERT INTO outbox_jobs (queue_name, job_id, payload)
    VALUES ('system.rebuild', ${jobId}, ${JSON.stringify(payload)}::jsonb)
    ON CONFLICT (job_id) DO NOTHING
  `;
  console.log(`[trigger] enqueued ${jobId} (scope=${values.scope})`);
  console.log('[trigger] the running worker will pick it up on the next dispatcher tick');
} finally {
  await sql.end({ timeout: 5 });
}
