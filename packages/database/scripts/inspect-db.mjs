#!/usr/bin/env node
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(__dirname, '..', 'package.json'));
const postgres = require('postgres');

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

try {
  console.log('=== webhook_events (last 3) ===');
  const events = await sql`
    SELECT id, status, object_type, external_object_id, field, received_at
    FROM webhook_events
    ORDER BY received_at DESC
    LIMIT 3
  `;
  console.table(events);

  console.log('\n=== outbox_jobs (last 3) ===');
  const jobs = await sql`
    SELECT queue_name, job_id, status, attempts, dispatched_at
    FROM outbox_jobs
    ORDER BY created_at DESC
    LIMIT 3
  `;
  console.table(jobs);

  console.log('\n=== external_interactions (last 3) ===');
  const interactions = await sql`
    SELECT interaction_type, external_interaction_id, content, occurred_at
    FROM external_interactions
    ORDER BY occurred_at DESC
    LIMIT 3
  `;
  console.table(interactions);

  console.log('\n=== webhook_subscriptions ===');
  const subs = await sql`
    SELECT id, provider, status, last_verified_at, last_rotated_at
    FROM webhook_subscriptions
  `;
  console.table(subs);
} finally {
  await sql.end({ timeout: 5 });
}
