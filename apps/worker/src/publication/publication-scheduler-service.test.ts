import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDatabaseClient,
  OutboxRepository,
  PublicationsRepository,
  TransactionManager,
  type DatabaseClient,
} from '@content-platform/database';
import { PublicationSchedulerService } from './publication-scheduler-service.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB_URL)('PublicationSchedulerService', () => {
  let client: DatabaseClient;
  let txManager: TransactionManager;
  let publicationsRepo: PublicationsRepository;
  let outboxRepo: OutboxRepository;
  let scheduler: PublicationSchedulerService;

  let destinationId: string;
  let contentItemId: string;
  let storyId: string;

  beforeAll(async () => {
    client = createDatabaseClient({ url: TEST_DB_URL! });
    txManager = new TransactionManager(client.db);
    publicationsRepo = new PublicationsRepository(client.db);
    outboxRepo = new OutboxRepository(client.db);

    scheduler = new PublicationSchedulerService({
      txManager,
      publicationsRepo,
      outboxRepo,
      batchSize: 10,
      reconcileStaleThresholdSeconds: 300,
    });

    const existingDest = await client.sql<{ id: string }[]>`
      SELECT id FROM destinations WHERE type = 'META' AND external_id = 'test-scheduler-dest' LIMIT 1
    `;
    if (existingDest[0]) {
      destinationId = existingDest[0].id;
    } else {
      const created = await client.sql<{ id: string }[]>`
        INSERT INTO destinations (name, type, external_id)
        VALUES ('Scheduler Test', 'META', 'test-scheduler-dest')
        RETURNING id
      `;
      destinationId = created[0]!.id;
    }

    const existingContent = await client.sql<{ id: string }[]>`
      SELECT id FROM content_items WHERE canonical_url = 'https://scheduler.test/item' LIMIT 1
    `;
    if (existingContent[0]) {
      contentItemId = existingContent[0].id;
    } else {
      const created = await client.sql<{ id: string }[]>`
        INSERT INTO content_items (canonical_url, status)
        VALUES ('https://scheduler.test/item', 'PUBLISHED')
        RETURNING id
      `;
      contentItemId = created[0]!.id;
    }

    const existingStory = await client.sql<{ id: string }[]>`
      SELECT id FROM stories WHERE title = 'Scheduler Test Story' LIMIT 1
    `;
    if (existingStory[0]) {
      storyId = existingStory[0].id;
    } else {
      const created = await client.sql<{ id: string }[]>`
        INSERT INTO stories (title, status)
        VALUES ('Scheduler Test Story', 'ACTIVE')
        RETURNING id
      `;
      storyId = created[0]!.id;
    }
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await client.sql`TRUNCATE outbox_jobs, publications, publication_candidates CASCADE`;
  });

  async function createPublication(input: {
    status: 'SCHEDULED' | 'RECONCILIATION';
    scheduledAt?: Date;
    updatedAtAgoSeconds?: number;
  }): Promise<string> {
    const candidate = await client.sql<{ id: string }[]>`
      INSERT INTO publication_candidates
        (content_id, story_id, version, title, caption, summary, source_url, validation_status)
      VALUES
        (${contentItemId}, ${storyId}, 1, 't', 'c', 's', 'https://scheduler.test/item', 'PASS')
      RETURNING id
    `;

    const scheduledAtLiteral =
      input.scheduledAt !== undefined ? input.scheduledAt.toISOString() : null;

    const created = await client.sql<{ id: string }[]>`
      INSERT INTO publications
        (publication_candidate_id, destination_id, status, scheduled_at)
      VALUES
        (${candidate[0]!.id}, ${destinationId}, ${input.status},
         ${scheduledAtLiteral}::timestamptz)
      RETURNING id
    `;
    const id = created[0]!.id;

    if (input.updatedAtAgoSeconds !== undefined) {
      await client.sql`
        UPDATE publications
        SET updated_at = now() - (${input.updatedAtAgoSeconds} * interval '1 second')
        WHERE id = ${id}
      `;
    }

    return id;
  }

  it('claims a due SCHEDULED publication and enqueues content.publish', async () => {
    const id = await createPublication({
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() - 60_000),
    });

    const result = await scheduler.runOnce();
    expect(result.scheduledCount).toBe(1);

    const row = await client.sql<{ status: string }[]>`
      SELECT status FROM publications WHERE id = ${id}
    `;
    expect(row[0]!.status).toBe('RESERVED');

    const jobs = await client.sql<{ queue_name: string; job_id: string }[]>`
      SELECT queue_name, job_id FROM outbox_jobs
    `;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.queue_name).toBe('content.publish');
    expect(jobs[0]!.job_id).toBe(`content.publish:${id}`);
  });

  it('does not claim a SCHEDULED publication whose time has not yet arrived', async () => {
    await createPublication({
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() + 60_000),
    });

    const result = await scheduler.runOnce();
    expect(result.scheduledCount).toBe(0);
  });

  it('touches a stale RECONCILIATION publication and enqueues publication.reconcile', async () => {
    const id = await createPublication({
      status: 'RECONCILIATION',
      updatedAtAgoSeconds: 3_600,
    });

    const result = await scheduler.runOnce();
    expect(result.reconciledCount).toBe(1);

    const jobs = await client.sql<{ queue_name: string; job_id: string }[]>`
      SELECT queue_name, job_id FROM outbox_jobs
    `;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.queue_name).toBe('publication.reconcile');
    expect(jobs[0]!.job_id.startsWith(`publication.reconcile:${id}:`)).toBe(true);

    const row = await client.sql<{ status: string }[]>`
      SELECT status FROM publications WHERE id = ${id}
    `;
    expect(row[0]!.status).toBe('RECONCILIATION');
  });

  it('does not touch a fresh RECONCILIATION publication', async () => {
    await createPublication({
      status: 'RECONCILIATION',
      updatedAtAgoSeconds: 10,
    });

    const result = await scheduler.runOnce();
    expect(result.reconciledCount).toBe(0);
  });

  it('is idempotent across consecutive runs for the same SCHEDULED row', async () => {
    const id = await createPublication({
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() - 60_000),
    });

    const first = await scheduler.runOnce();
    expect(first.scheduledCount).toBe(1);

    const second = await scheduler.runOnce();
    expect(second.scheduledCount).toBe(0);

    const jobs = await client.sql<{ c: number }[]>`
      SELECT COUNT(*)::int AS c FROM outbox_jobs WHERE job_id = ${'content.publish:' + id}
    `;
    expect(jobs[0]!.c).toBe(1);
  });
});
