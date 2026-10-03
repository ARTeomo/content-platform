#!/usr/bin/env node
//
// Manually enqueue a `system.outbox.cleanup` job.
//
// Usage (from the repository root):
//   export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)"
//   node packages/database/scripts/trigger-outbox-cleanup.mjs
//   node packages/database/scripts/trigger-outbox-cleanup.mjs --retention-days 1

import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(__dirname, '..', 'package.json'));
const postgres = require('postgres');

const { values } = parseArgs({
  options: {
    'retention-days': { type: 'string' },
  },
});

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set.');
  process.exit(1);
}

const payload = {};
if (values['retention-days'] !== undefined) {
  const days = Number.parseInt(values['retention-days'], 10);
  if (!Number.isInteger(days) || days <= 0) {
    console.error('ERROR: --retention-days must be a positive integer.');
    process.exit(1);
  }
  payload.retentionDays = days;
}

const sql = postgres(DATABASE_URL, { max: 1 });

const ts = Date.now();
const jobId = `system.outbox.cleanup:${ts}`;

try {
  await sql`
    INSERT INTO outbox_jobs (queue_name, job_id, payload)
    VALUES ('system.outbox.cleanup', ${jobId}, ${JSON.stringify(payload)}::jsonb)
    ON CONFLICT (job_id) DO NOTHING
  `;
  console.log(`[trigger] enqueued ${jobId}`);
  console.log('[trigger] the running worker will pick it up on the next dispatcher tick');
} finally {
  await sql.end({ timeout: 5 });
}
