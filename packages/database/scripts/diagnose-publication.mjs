#!/usr/bin/env node
//
// Phase 19e — Diagnose a publication's outbound pipeline state.
//
// Usage (from the repository root):
//   export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)"
//   node packages/database/scripts/diagnose-publication.mjs <publication-id>

import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
const PUBLICATION_ID = process.argv[2] ?? process.env.PUBLICATION_ID;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set.');
  process.exit(1);
}
if (!PUBLICATION_ID) {
  console.error('ERROR: publication id is required.');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });

function line(label, value) {
  console.log(`  ${String(label).padEnd(24)}${value ?? '(null)'}`);
}

async function main() {
  console.log('=== Phase 19e — Publication pipeline state ===');
  console.log('');
  line('publication.id:', PUBLICATION_ID);
  console.log('');

  console.log('[1/3] publications');
  const [pub] = await sql`
    SELECT id, status, scheduled_at, updated_at, published_at,
           external_post_id, destination_id, publication_candidate_id
    FROM publications
    WHERE id = ${PUBLICATION_ID}
    LIMIT 1
  `;
  if (!pub) {
    console.log('  NOT FOUND');
  } else {
    line('status:', pub.status);
    line('scheduled_at:', pub.scheduled_at);
    line('updated_at:', pub.updated_at);
    line('published_at:', pub.published_at);
    line('external_post_id:', pub.external_post_id);
    line('destination_id:', pub.destination_id);
    line('candidate_id:', pub.publication_candidate_id);
  }
  console.log('');

  console.log('[2/3] outbox_jobs');
  const jobs = await sql`
    SELECT id, queue_name, job_id, status, attempts,
           last_attempt_at, dispatched_at, last_error, created_at
    FROM outbox_jobs
    WHERE job_id LIKE ${'%' + PUBLICATION_ID + '%'}
    ORDER BY created_at DESC
  `;
  if (jobs.length === 0) {
    console.log('  (no rows)');
  } else {
    for (const job of jobs) {
      console.log(`  -- ${job.queue_name} (${job.status}) --`);
      line('job_id:', job.job_id);
      line('attempts:', job.attempts);
      line('last_attempt_at:', job.last_attempt_at);
      line('dispatched_at:', job.dispatched_at);
      line('last_error:', job.last_error);
      line('created_at:', job.created_at);
      console.log('');
    }
  }

  console.log('[3/3] publication_attempts');
  const attempts = await sql`
    SELECT id, attempt_number, status, started_at, finished_at,
           error_category, error_message, external_post_id
    FROM publication_attempts
    WHERE publication_id = ${PUBLICATION_ID}
    ORDER BY attempt_number ASC
  `;
  if (attempts.length === 0) {
    console.log('  (no rows)');
  } else {
    for (const a of attempts) {
      console.log(`  -- attempt #${a.attempt_number} (${a.status}) --`);
      line('started_at:', a.started_at);
      line('finished_at:', a.finished_at);
      line('error_category:', a.error_category);
      line('error_message:', a.error_message);
      line('external_post_id:', a.external_post_id);
      console.log('');
    }
  }
}

main()
  .then(async () => {
    await sql.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('FATAL:', err);
    await sql.end();
    process.exit(1);
  });
