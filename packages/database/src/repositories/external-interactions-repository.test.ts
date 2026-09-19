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
 * Idempotency contract:
 *
 *   - If the marker publication still exists, reuse it.
 *   - Otherwise, create the whole chain with ON CONFLICT DO NOTHING at
 *     every layer that has a unique constraint (destinations on
 *     (type, external_id); content_items on canonical_url; stories and
 *     publication_candidates have no unique constraint, so they are
 *     looked up by a stable marker first).
 *
 * The function must not fail because a previous partial run left orphan
 * destination or content_item rows behind.
 */
async function ensurePublicationScaffolding(client: DatabaseClient): Promise<string> {
  const publicationMarker = 'test-scaffolding-post';

  // Fast path: publication still exists from a previous run.
  const existingPub = await client.sql<{ id: string }[]>`
    SELECT id FROM publications WHERE external_post_id = ${publicationMarker} LIMIT 1
  `;
  if (existingPub[0]) return existingPub[0].id;

  // Slow path: rebuild the FK chain, idempotently.
  const destinationId = await ensureDestination(client);
  const storyId = await ensureStory(client);
  const contentItemId = await ensureContentItem(client);
  const candidateId = await ensureCandidate(client, contentItemId, storyId);

  const [publication] = await client.sql<{ id: string }[]>`
    INSERT INTO publications (publication_candidate_id, destination_id, status, external_post_id)
    VALUES (${candidateId}, ${destinationId}, 'PUBLISHED', ${publicationMarker})
    RETURNING id
  `;
  if (!publication) throw new Error('scaffolding: publication insert failed');
  return publication.id;
}

async function ensureDestination(client: DatabaseClient): Promise<string> {
  const marker = 'test-destination-scaffolding';
  const [inserted] = await client.sql<{ id: string }[]>`
    INSERT INTO destinations (name, type, external_id)
    VALUES ('Test Destination', 'META', ${marker})
    ON CONFLICT (type, external_id) DO NOTHING
    RETURNING id
  `;
  if (inserted) return inserted.id;

  const [existing] = await client.sql<{ id: string }[]>`
    SELECT id FROM destinations WHERE type = 'META' AND external_id = ${marker} LIMIT 1
  `;
  if (!existing) throw new Error('scaffolding: destination missing after conflict');
  return existing.id;
}

async function ensureStory(client: DatabaseClient): Promise<string> {
  // stories has no unique constraint — use a stable title marker.
  const marker = 'Test Story (scaffolding)';
  const [existing] = await client.sql<{ id: string }[]>`
    SELECT id FROM stories WHERE title = ${marker} LIMIT 1
  `;
  if (existing) return existing.id;

  const [inserted] = await client.sql<{ id: string }[]>`
    INSERT INTO stories (title, status)
    VALUES (${marker}, 'ACTIVE')
    RETURNING id
  `;
  if (!inserted) throw new Error('scaffolding: story insert failed');
  return inserted.id;
}

async function ensureContentItem(client: DatabaseClient): Promise<string> {
  const marker = 'https://test.example.com/scaffolding';
  const [inserted] = await client.sql<{ id: string }[]>`
    INSERT INTO content_items (canonical_url, status)
    VALUES (${marker}, 'PUBLISHED')
    ON CONFLICT (canonical_url) DO NOTHING
    RETURNING id
  `;
  if (inserted) return inserted.id;

  const [existing] = await client.sql<{ id: string }[]>`
    SELECT id FROM content_items WHERE canonical_url = ${marker} LIMIT 1
  `;
  if (!existing) throw new Error('scaffolding: content_item missing after conflict');
  return existing.id;
}

async function ensureCandidate(
  client: DatabaseClient,
  contentItemId: string,
  storyId: string,
): Promise<string> {
  // publication_candidates has no unique constraint on (content_id,
  // story_id) — look up an existing candidate first.
  const [existing] = await client.sql<{ id: string }[]>`
    SELECT id FROM publication_candidates
    WHERE content_id = ${contentItemId} AND story_id = ${storyId}
    LIMIT 1
  `;
  if (existing) return existing.id;

  const [inserted] = await client.sql<{ id: string }[]>`
    INSERT INTO publication_candidates (
      content_id, story_id, version, title, caption, summary, source_url, validation_status
    )
    VALUES (
      ${contentItemId}, ${storyId}, 1, 'Test', 'Test', 'Test',
      'https://test.example.com/scaffolding', 'PASS'
    )
    RETURNING id
  `;
  if (!inserted) throw new Error('scaffolding: publication_candidate insert failed');
  return inserted.id;
}
