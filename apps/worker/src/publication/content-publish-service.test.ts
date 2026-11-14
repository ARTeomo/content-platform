import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDatabaseClient,
  PublicationAttemptsRepository,
  PublicationsRepository,
  TransactionManager,
  type DatabaseClient,
} from '@content-platform/database';
import type { MetaPublisherAdapter } from '@content-platform/publishers';
import { ContentPublishService, type ContentPublishServiceDeps } from './content-publish-service.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB_URL)('ContentPublishService', () => {
  let client: DatabaseClient;
  let txManager: TransactionManager;
  let publicationsRepo: PublicationsRepository;
  let attemptsRepo: PublicationAttemptsRepository;

  let destinationId: string;
  let otherDestinationId: string;
  let contentItemId: string;
  let storyId: string;

  beforeAll(async () => {
    client = createDatabaseClient({ url: TEST_DB_URL! });
    txManager = new TransactionManager(client.db);
    publicationsRepo = new PublicationsRepository(client.db);
    attemptsRepo = new PublicationAttemptsRepository(client.db);

    destinationId = await ensureDestination(client, 'test-publish-dest');
    otherDestinationId = await ensureDestination(client, 'test-publish-dest-other');
    storyId = await ensureStory(client, 'Publish Test Story');
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await client.sql`TRUNCATE outbox_jobs, notifications, publication_attempts, publications, publication_candidates CASCADE`;
    contentItemId = await ensureContentItem(
      client,
      `https://publish.test/item-${crypto.randomUUID()}`,
    );
  });

  function makeAdapter(outcome: {
    status: 'SUCCESS';
    externalPostId: string;
  }): MetaPublisherAdapter {
    return {
      postToPage: async () => outcome,
    } as unknown as MetaPublisherAdapter;
  }

  function buildService(
    adapter: MetaPublisherAdapter,
    logger?: { warn: (message?: unknown, ...optionalParams: unknown[]) => void },
  ): ContentPublishService {
    const deps: ContentPublishServiceDeps = {
      db: client.db,
      txManager,
      publicationsRepo,
      attemptsRepo,
      publisherAdapter: adapter,
    };
    if (logger !== undefined) {
      deps.logger = { info: vi.fn(), error: vi.fn(), warn: logger.warn };
    }
    return new ContentPublishService(deps);
  }

  async function createScheduledPublication(opts: {
    destinationId: string;
    contentItemId: string;
  }): Promise<string> {
    const candidate = await client.sql<{ id: string }[]>`
      INSERT INTO publication_candidates
        (content_id, story_id, version, title, caption, summary, source_url, validation_status)
      VALUES
        (${opts.contentItemId}, ${storyId}, 1, 't', 'c', 's', 'https://publish.test/item', 'PASS')
      RETURNING id
    `;
    const created = await client.sql<{ id: string }[]>`
      INSERT INTO publications
        (publication_candidate_id, destination_id, status, scheduled_at)
      VALUES
        (${candidate[0]!.id}, ${opts.destinationId}, 'SCHEDULED', now() - interval '1 minute')
      RETURNING id
    `;
    return created[0]!.id;
  }

  async function createFailureNotification(publicationId: string): Promise<string> {
    const created = await client.sql<{ id: string }[]>`
      INSERT INTO notifications (type, severity, title, message, publication_id)
      VALUES ('publication_failure', 'ERROR', 'failed', 'x', ${publicationId})
      RETURNING id
    `;
    return created[0]!.id;
  }

  it('success: marks publication and attempt, flips parent to PUBLISHED with timestamp, resolves open failure notifications', async () => {
    const publicationId = await createScheduledPublication({
      destinationId,
      contentItemId,
    });
    // A prior failure notification attached to this very publication
    // (its candidate's content + destination scope the resolution).
    const notificationId = await createFailureNotification(publicationId);

    const service = buildService(makeAdapter({ status: 'SUCCESS', externalPostId: 'ext-post-1' }));
    const outcome = await service.publish({ publicationId });

    expect(outcome).toEqual({ status: 'PUBLISHED', externalPostId: 'ext-post-1' });

    const pub = await client.sql<
      { status: string; external_post_id: string; published_at: string | null }[]
    >`SELECT status, external_post_id, published_at FROM publications WHERE id = ${publicationId}`;
    expect(pub[0]!.status).toBe('PUBLISHED');
    expect(pub[0]!.external_post_id).toBe('ext-post-1');
    expect(pub[0]!.published_at).not.toBeNull();

    const attempt = await client.sql<{ status: string; external_post_id: string }[]>`
      SELECT status, external_post_id FROM publication_attempts WHERE publication_id = ${publicationId}
    `;
    expect(attempt).toHaveLength(1);
    expect(attempt[0]!.status).toBe('SUCCESS');

    const item = await client.sql<{ status: string; published_at: string | null }[]>`
      SELECT status, published_at FROM content_items WHERE id = ${contentItemId}
    `;
    expect(item[0]!.status).toBe('PUBLISHED');
    expect(item[0]!.published_at).not.toBeNull();

    const note = await client.sql<{ resolved_at: string | null; is_read: boolean }[]>`
      SELECT resolved_at, is_read FROM notifications WHERE id = ${notificationId}
    `;
    expect(note[0]!.resolved_at).not.toBeNull();
    expect(note[0]!.is_read).toBe(false);
  });

  it('success: does not resolve failure notifications for a different destination', async () => {
    const publicationId = await createScheduledPublication({
      destinationId,
      contentItemId,
    });
    // Notification tied to a publication on the SAME content but a
    // DIFFERENT destination must stay open.
    const otherPublicationId = await createScheduledPublication({
      destinationId: otherDestinationId,
      contentItemId,
    });
    const notificationId = await createFailureNotification(otherPublicationId);

    const service = buildService(makeAdapter({ status: 'SUCCESS', externalPostId: 'ext-post-2' }));
    await service.publish({ publicationId });

    const note = await client.sql<{ resolved_at: string | null }[]>`
      SELECT resolved_at FROM notifications WHERE id = ${notificationId}
    `;
    expect(note[0]!.resolved_at).toBeNull();
  });

  it('success: keeps the earliest published_at when the parent was already published via another destination', async () => {
    const firstPublicationId = await createScheduledPublication({
      destinationId,
      contentItemId,
    });
    const service = buildService(makeAdapter({ status: 'SUCCESS', externalPostId: 'ext-post-3a' }));
    await service.publish({ publicationId: firstPublicationId });
    const afterFirst = await client.sql<{ published_at: string }[]>`
      SELECT published_at FROM content_items WHERE id = ${contentItemId}
    `;
    const firstTs = afterFirst[0]!.published_at;

    // A second destination succeeds later; the parent timestamp must
    // not move (first-success rule, owner decision 2026-11-14).
    const secondPublicationId = await createScheduledPublication({
      destinationId: otherDestinationId,
      contentItemId,
    });
    await service.publish({ publicationId: secondPublicationId });

    const afterSecond = await client.sql<{ published_at: string; status: string }[]>`
      SELECT published_at, status FROM content_items WHERE id = ${contentItemId}
    `;
    expect(afterSecond[0]!.status).toBe('PUBLISHED');
    expect(afterSecond[0]!.published_at).toBe(firstTs);
  });
});

// ---------------------------------------------------------------------------
// Scaffolding
// ---------------------------------------------------------------------------

async function ensureDestination(client: DatabaseClient, marker: string): Promise<string> {
  const existing = await client.sql<{ id: string }[]>`
    SELECT id FROM destinations WHERE external_id = ${marker}
  `;
  if (existing[0]) return existing[0].id;
  const created = await client.sql<{ id: string }[]>`
    INSERT INTO destinations (name, type, external_id)
    VALUES ('Publish Test', 'META', ${marker})
    RETURNING id
  `;
  return created[0]!.id;
}

async function ensureContentItem(client: DatabaseClient, url: string): Promise<string> {
  const created = await client.sql<{ id: string }[]>`
    INSERT INTO content_items (canonical_url, status)
    VALUES (${url}, 'DRAFT')
    RETURNING id
  `;
  return created[0]!.id;
}

async function ensureStory(client: DatabaseClient, title: string): Promise<string> {
  const existing = await client.sql<{ id: string }[]>`
    SELECT id FROM stories WHERE title = ${title} LIMIT 1
  `;
  if (existing[0]) return existing[0].id;
  const created = await client.sql<{ id: string }[]>`
    INSERT INTO stories (title, status)
    VALUES (${title}, 'ACTIVE')
    RETURNING id
  `;
  return created[0]!.id;
}
