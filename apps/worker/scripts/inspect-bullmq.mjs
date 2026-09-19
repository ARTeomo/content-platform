#!/usr/bin/env node
//
// Phase 19e — Inspect (and optionally remove) BullMQ queue state.
//
// Usage (from the repository root):
//   export REDIS_URL="$(grep '^REDIS_URL=' .env | cut -d= -f2-)"
//   node apps/worker/scripts/inspect-bullmq.mjs <queue-name> [job-id] [--remove]
//
// The BullMQ default prefix is `bull`; pass QUEUE_PREFIX to override.
//
// --remove with a job-id removes that job (in any state) so a subsequent
// queue.add() with the same jobId can succeed. Without --remove the
// script only reports.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;
const QUEUE_PREFIX = process.env.QUEUE_PREFIX ?? 'bull';

const args = process.argv.slice(2);
const removeFlag = args.includes('--remove');
const positional = args.filter((a) => !a.startsWith('--'));
const QUEUE_NAME = positional[0];
const JOB_ID = positional[1];

if (!REDIS_URL) {
  console.error('ERROR: REDIS_URL is not set.');
  process.exit(1);
}
if (!QUEUE_NAME) {
  console.error('ERROR: queue name is required.');
  console.error(
    '  node apps/worker/scripts/inspect-bullmq.mjs content.publish [job-id] [--remove]',
  );
  process.exit(1);
}

function redisOptionsFromUrl(url) {
  const parsed = new URL(url);
  const opts = {
    host: parsed.hostname,
    port: Number.parseInt(parsed.port || '6379', 10),
    family: 4,
  };
  if (parsed.password) opts.password = decodeURIComponent(parsed.password);
  if (parsed.username && parsed.username !== 'default') {
    opts.username = decodeURIComponent(parsed.username);
  }
  if (parsed.protocol === 'rediss:' || parsed.hostname.endsWith('.upstash.io')) {
    opts.tls = { servername: parsed.hostname };
  }
  return opts;
}

const connection = new IORedis(redisOptionsFromUrl(REDIS_URL), {
  maxRetriesPerRequest: null,
});

const queue = new Queue(QUEUE_NAME, { connection, prefix: QUEUE_PREFIX });

console.log('=== BullMQ queue inspection ===');
console.log('  queue name: ', QUEUE_NAME);
console.log('  prefix:     ', QUEUE_PREFIX);
console.log('');

const counts = await queue.getJobCounts(
  'waiting',
  'active',
  'delayed',
  'completed',
  'failed',
  'paused',
);
console.log('Counts:');
for (const [state, n] of Object.entries(counts)) {
  console.log(`  ${state.padEnd(12)} ${n}`);
}
console.log('');

if (JOB_ID) {
  console.log(`Specific job: ${JOB_ID}`);
  const job = await queue.getJob(JOB_ID);
  if (!job) {
    console.log('  NOT FOUND');
  } else {
    const state = await job.getState();
    console.log(`  state:         ${state}`);
    console.log(`  attemptsMade:  ${job.attemptsMade}`);
    console.log(`  data:          ${JSON.stringify(job.data)}`);
    console.log(`  returnvalue:   ${JSON.stringify(job.returnvalue)}`);
    console.log(`  failedReason:  ${job.failedReason ?? '(none)'}`);
    console.log(`  timestamp:     ${job.timestamp ? new Date(job.timestamp).toISOString() : '-'}`);
    console.log(
      `  processedOn:   ${job.processedOn ? new Date(job.processedOn).toISOString() : '-'}`,
    );
    console.log(
      `  finishedOn:    ${job.finishedOn ? new Date(job.finishedOn).toISOString() : '-'}`,
    );

    if (removeFlag) {
      await job.remove();
      console.log('  REMOVED');
    }
  }
  console.log('');
}

console.log('All jobs (up to 100, any state):');
const allJobs = await queue.getJobs(
  ['waiting', 'active', 'delayed', 'completed', 'failed'],
  0,
  100,
);
if (allJobs.length === 0) {
  console.log('  (none)');
} else {
  for (const j of allJobs) {
    const s = await j.getState();
    console.log(`  ${j.id}`);
    console.log(`    state=${s} attemptsMade=${j.attemptsMade} name=${j.name}`);
  }
}

await queue.close();
await connection.quit();
