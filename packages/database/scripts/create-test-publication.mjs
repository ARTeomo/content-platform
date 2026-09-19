#!/usr/bin/env node
//
// Phase 19e — Create a real SCHEDULED publication for outbound E2E
// validation.
//
// This script lives under packages/database/scripts/ so that Node's
// module resolution finds the `postgres` package (a direct dependency
// of @content-platform/database).
//
// The publication is created with scheduled_at = now() - 1 minute so
// the running PublicationSchedulerWorker picks it up on its next tick
// (default interval: 30s).
//
// The FK chain created:
//   content_items
//     → publication_candidates ← stories
//       → publications (status = SCHEDULED)
//
// Usage (from the repository root):
//   export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)"
//   export META_PAGE_ID=1287488901121523
//   node packages/database/scripts/create-test-publication.mjs
//
// Note: this script is intentionally non-idempotent — each run creates
// a new test publication.

import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
const PAGE_ID = process.env.META_PAGE_ID ?? '1287488901121523';

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set.');
  console.error('Export it first, e.g.:');
  console.error('  export DATABASE_URL="$(grep \'^DATABASE_URL=\' .env | cut -d= -f2-)"');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });

function line(label, value) {
  console.log(`  ${label.padEnd(28)}${value}`);
}

async function main() {
  console.log('=== Phase 19e — Create test publication ===');
  console.log('');

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');

  // 1. Resolve destination
  const [destination] = await sql`
    SELECT id, name, external_id
    FROM destinations
    WHERE type = 'META' AND external_id = ${PAGE_ID}
    LIMIT 1
  `;

  if (!destination) {
    console.error(`ERROR: no META destination with external_id=${PAGE_ID}`);
    console.error('Run the Phase 18a seed script first, or check the destinations table.');
    process.exit(1);
  }

  console.log('[1/5] Destination resolved');
  line('destination.id:', destination.id);
  line('destination.name:', destination.name);
  console.log('');

  // 2. Create content_item
  const canonicalUrl = `https://contentplatform.dev/test/phase-19e-${stamp}`;
  const [contentItem] = await sql`
    INSERT INTO content_items (canonical_url, status)
    VALUES (${canonicalUrl}, 'PUBLISHED')
    RETURNING id
  `;

  console.log('[2/5] Content item created');
  line('content_item.id:', contentItem.id);
  line('canonical_url:', canonicalUrl);
  console.log('');

  // 3. Create story
  const [story] = await sql`
    INSERT INTO stories (title, summary, status)
    VALUES (
      ${'Phase 19e E2E Test Story — ' + stamp},
      'Automated test story created by the Phase 19e outbound E2E harness.',
      'ACTIVE'
    )
    RETURNING id
  `;

  console.log('[3/5] Story created');
  line('story.id:', story.id);
  console.log('');

  // 4. Create publication_candidate
  const title = 'Content Platform — Phase 19e E2E Test';
  const caption =
    'Phase 19e E2E test publication from Content Platform.\n\n' +
    `Timestamp: ${now.toISOString()}\n\n` +
    'This post validates the complete outbound publication lifecycle: ' +
    'scheduler → outbox → content.publish → MetaPublisherAdapter → ' +
    'Meta Graph API → PUBLISHED.';
  const summary = 'Automated test publication for Phase 19e outbound E2E validation.';

  const [candidate] = await sql`
    INSERT INTO publication_candidates (
      content_id, story_id, version,
      title, caption, summary, source_url, validation_status
    )
    VALUES (
      ${contentItem.id}, ${story.id}, 1,
      ${title}, ${caption}, ${summary},
      ${canonicalUrl}, 'PASS'
    )
    RETURNING id
  `;

  console.log('[4/5] Publication candidate created');
  line('candidate.id:', candidate.id);
  console.log('');

  // 5. Create publication (SCHEDULED, due now)
  const [publication] = await sql`
    INSERT INTO publications (
      publication_candidate_id, destination_id, status, scheduled_at
    )
    VALUES (
      ${candidate.id}, ${destination.id}, 'SCHEDULED',
      now() - interval '1 minute'
    )
    RETURNING id, status, scheduled_at
  `;

  console.log('[5/5] Publication created');
  line('publication.id:', publication.id);
  line('publication.status:', publication.status);
  line('publication.scheduled_at:', String(publication.scheduled_at));
  console.log('');

  console.log('=== READY ===');
  console.log('');
  console.log('The scheduler will pick up this publication on its next tick');
  console.log('(PUBLICATION_SCHEDULE_INTERVAL_MS, default 30s).');
  console.log('');
  console.log('Watch the worker logs for:');
  console.log('  [publication.schedule] scheduled=1 reconciled=0');
  console.log('  [content.publish] job content.publish:' + publication.id);
  console.log('');
  console.log('Verify state transitions with:');
  console.log(
    `  SELECT status, external_post_id, published_at, updated_at FROM publications WHERE id = '${publication.id}';`,
  );
  console.log('');
  console.log('Poll the outbox with:');
  console.log(
    `  SELECT status, attempts, dispatched_at FROM outbox_jobs WHERE job_id = 'content.publish:${publication.id}';`,
  );
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
