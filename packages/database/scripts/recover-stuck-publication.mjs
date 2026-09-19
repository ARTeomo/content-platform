#!/usr/bin/env node
//
// Phase 19e — Recover a publication stuck in RESERVED.
//
// Resets the publication to SCHEDULED with scheduled_at = now() - 1 min
// and removes the DISPATCHED outbox row so the scheduler can re-enqueue
// it with the same deterministic job_id.
//
// Usage (from the repository root):
//   export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)"
//   node packages/database/scripts/recover-stuck-publication.mjs <publication-id>
//
// Or set PUBLICATION_ID via env:
//   PUBLICATION_ID=... node packages/database/scripts/recover-stuck-publication.mjs

import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
const PUBLICATION_ID = process.argv[2] ?? process.env.PUBLICATION_ID;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set.');
  console.error('  export DATABASE_URL="$(grep \'^DATABASE_URL=\' .env | cut -d= -f2-)"');
  process.exit(1);
}

if (!PUBLICATION_ID) {
  console.error('ERROR: publication id is required.');
  console.error('  node packages/database/scripts/recover-stuck-publication.mjs <publication-id>');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });

function line(label, value) {
  console.log(`  ${label.padEnd(24)}${value}`);
}

async function main() {
  console.log('=== Phase 19e — Recover stuck publication ===');
  console.log('');
  line('publication.id:', PUBLICATION_ID);
  console.log('');

  // 1. Reset the publication to SCHEDULED.
  const [pub] = await sql`
    UPDATE publications
    SET status = 'SCHEDULED',
        scheduled_at = now() - interval '1 minute',
        updated_at = now()
    WHERE id = ${PUBLICATION_ID}
    RETURNING id, status, scheduled_at, updated_at
  `;

  if (!pub) {
    console.error(`ERROR: no publication with id=${PUBLICATION_ID}`);
    process.exit(1);
  }

  console.log('[1/2] Publication reset');
  line('status:', pub.status);
  line('scheduled_at:', String(pub.scheduled_at));
  console.log('');

  // 2. Remove the DISPATCHED outbox row so the UNIQUE job_id
  //    constraint does not block the scheduler's re-enqueue.
  const deleted = await sql`
    DELETE FROM outbox_jobs
    WHERE job_id = ${'content.publish:' + PUBLICATION_ID}
    RETURNING job_id, status
  `;

  console.log('[2/2] Outbox rows removed');
  if (deleted.length === 0) {
    line('rows removed:', 0);
  } else {
    for (const row of deleted) {
      line('removed:', `${row.job_id} (${row.status})`);
    }
  }
  console.log('');

  console.log('=== READY ===');
  console.log('');
  console.log('The scheduler will pick up this publication on its next tick.');
  console.log('Watch the worker for:');
  console.log('  [publication.schedule] scheduled=1 reconciled=0');
  console.log('  [content.publish] publication ' + PUBLICATION_ID + ' → PUBLISHED (...)');
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
