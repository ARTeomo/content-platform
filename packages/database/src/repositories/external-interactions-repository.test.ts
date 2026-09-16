import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabaseClient, type DatabaseClient } from '../client.js';
import { ExternalInteractionsRepository } from './external-interactions-repository.js';
import { TransactionManager } from '../transaction/transaction-manager.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB_URL)('ExternalInteractionsRepository', () => {
  let client: DatabaseClient;
  let repo: ExternalInteractionsRepository;
  let txManager: TransactionManager;
  let publicationId: string;

  beforeAll(async () => {
    client = createDatabaseClient({ url: TEST_DB_URL! });
    repo = new ExternalInteractionsRepository(client.db);
    txManager = new TransactionManager(client.db);
    publicationId = await ensurePublicationScaffolding(client);
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await client.sql`TRUNCATE external_interactions RESTART IDENTITY CASCADE`;
  });

  it('inserts a new interaction', async () => {
    const result = await txManager.run(async (tx) =>
      repo.upsertMonotonic(tx, {
        interactionType: 'COMMENT',
        externalInteractionId: 'comment-1',
        content: 'hello',
        occurredAt: new Date('2026-01-01T10:00:00Z'),
      }),
    );

    expect(result.skipped).toBe(false);
    expect(result.interaction.content).toBe('hello');
  });

  it('updates an existing interaction when the incoming event is newer', async () => {
    await txManager.run(async (tx) =>
      repo.upsertMonotonic(tx, {
        interactionType: 'COMMENT',
        externalInteractionId: 'comment-2',
        content: 'first',
        occurredAt: new Date('2026-01-01T10:00:00Z'),
      }),
    );

    const result = await txManager.run(async (tx) =>
      repo.upsertMonotonic(tx, {
        interactionType: 'COMMENT',
        externalInteractionId: 'comment-2',
        content: 'edited',
        occurredAt: new Date('2026-01-01T10:05:00Z'),
      }),
    );

    expect(result.skipped).toBe(false);
    expect(result.interaction.content).toBe('edited');
  });

  it('skips a stale event (occurred_at older than persisted)', async () => {
    await txManager.run(async (tx) =>
      repo.upsertMonotonic(tx, {
        interactionType: 'COMMENT',
        externalInteractionId: 'comment-3',
        content: 'newer',
        occurredAt: new Date('2026-01-01T10:10:00Z'),
      }),
    );

    const result = await txManager.run(async (tx) =>
      repo.upsertMonotonic(tx, {
        interactionType: 'COMMENT',
        externalInteractionId: 'comment-3',
        content: 'older (should be ignored)',
        occurredAt: new Date('2026-01-01T10:00:00Z'),
      }),
    );

    expect(result.skipped).toBe(true);
    expect(result.interaction.content).toBe('newer');
  });

  it('preserves the existing publication_id when the incoming event omits it', async () => {
    await txManager.run(async (tx) =>
      repo.upsertMonotonic(tx, {
        interactionType: 'COMMENT',
        externalInteractionId: 'comment-4',
        content: 'first',
        publicationId,
        occurredAt: new Date('2026-01-01T10:00:00Z'),
      }),
    );

    const result = await txManager.run(async (tx) =>
      repo.upsertMonotonic(tx, {
        interactionType: 'COMMENT',
        externalInteractionId: 'comment-4',
        content: 'edited',
        occurredAt: new Date('2026-01-01T10:05:00Z'),
      }),
    );

    expect(result.interaction.publicationId).toBe(publicationId);
  });
});

/**
 * Create the minimal FK scaffolding needed to reference a real
 * publications row from external_interactions.
 *
 * `external_interactions.publication_id` has a deferred FK to
 * `publications.id` (added in Phase 11). To test the COALESCE behavior on
 * publication_id, the test needs a real publication to reference.
 *
 * The scaffolding is created once per test run and is idempotent: a
 * stable `external_post_id` marker identifies the scaffolding row, and
 * the function returns its id if found.
 */
async function ensurePublicationScaffolding(client: DatabaseClient): Promise<string> {
  const marker = 'test-scaffolding-post';

  const existing = await client.sql<{ id: string }[]>`
    SELECT id FROM publications WHERE external_post_id = ${marker}
  `;
  if (existing[0]) {
    return existing[0].id;
  }

  return await client.sql.begin(async (tx) => {
    const [destination] = await tx<{ id: string }[]>`
      INSERT INTO destinations (name, type, external_id)
      VALUES ('Test Destination', 'META', 'test-destination-scaffolding')
      RETURNING id
    `;
    if (!destination) throw new Error('scaffolding: destination insert failed');

    const [story] = await tx<{ id: string }[]>`
      INSERT INTO stories (title, status)
      VALUES ('Test Story', 'ACTIVE')
      RETURNING id
    `;
    if (!story) throw new Error('scaffolding: story insert failed');

    const [contentItem] = await tx<{ id: string }[]>`
      INSERT INTO content_items (canonical_url, status)
      VALUES ('https://test.example.com/scaffolding', 'PUBLISHED')
      RETURNING id
    `;
    if (!contentItem) throw new Error('scaffolding: content_item insert failed');

    const [candidate] = await tx<{ id: string }[]>`
      INSERT INTO publication_candidates (
        content_id, story_id, version, title, caption, summary, source_url, validation_status
      )
      VALUES (
        ${contentItem.id}, ${story.id}, 1, 'Test', 'Test', 'Test',
        'https://test.example.com/scaffolding', 'PASS'
      )
      RETURNING id
    `;
    if (!candidate) throw new Error('scaffolding: publication_candidate insert failed');

    const [publication] = await tx<{ id: string }[]>`
      INSERT INTO publications (publication_candidate_id, destination_id, status, external_post_id)
      VALUES (${candidate.id}, ${destination.id}, 'PUBLISHED', ${marker})
      RETURNING id
    `;
    if (!publication) throw new Error('scaffolding: publication insert failed');

    return publication.id;
  });
}
