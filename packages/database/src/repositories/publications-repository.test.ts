import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDatabaseClient,
  PublicationsRepository,
  TransactionManager,
  type DatabaseClient,
} from '@content-platform/database';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB_URL)('PublicationsRepository', () => {
  let client: DatabaseClient;
  let txManager: TransactionManager;
  let repo: PublicationsRepository;

  let destinationId: string;
  let otherDestinationId: string;
  let contentItemId: string;
  let storyId: string;

  beforeAll(async () => {
    client = createDatabaseClient({ url: TEST_DB_URL! });
    txManager = new TransactionManager(client.db);
    repo = new PublicationsRepository(client.db);

    destinationId = await ensureDestination(client, 'test-requeue-dest');
    otherDestinationId = await ensureDestination(client, 'test-requeue-dest-other');
    storyId = await ensureStory(client, 'Requeue Test Story');
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await client.sql`TRUNCATE publication_attempts, publications, publication_candidates CASCADE`;
    contentItemId = await ensureContentItem(client, `https://requeue.test/${crypto.randomUUID()}`);
  });

  async function createCandidate(): Promise<string> {
    const candidate = await client.sql<{ id: string }[]>`
      INSERT INTO publication_candidates
        (content_id, story_id, version, title, caption, summary, source_url, validation_status)
      VALUES
        (${contentItemId}, ${storyId}, 1, 't', 'c', 's', 'https://requeue.test/item', 'PASS')
      RETURNING id
    `;
    return candidate[0]!.id;
  }

  async function createFailedPublication(
    candidateId: string,
    destId: string,
    failureCategory: string | null,
  ): Promise<string> {
    const created = await client.sql<{ id: string }[]>`
      INSERT INTO publications
        (publication_candidate_id, destination_id, status, failure_category)
      VALUES
        (${candidateId}, ${destId}, 'FAILED', ${failureCategory})
      RETURNING id
    `;
    return created[0]!.id;
  }

  async function getPublication(id: string): Promise<{
    status: string;
    failure_category: string | null;
    scheduled_at: string | null;
  }> {
    const [row] = await client.sql<
      { status: string; failure_category: string | null; scheduled_at: string | null }[]
    >`
      SELECT status, failure_category, scheduled_at FROM publications WHERE id = ${id}
    `;
    return row!;
  }

  it('requeues only FAILED + CREDENTIAL_GATE rows for the given destination', async () => {
    const gateBlocked = await createFailedPublication(
      await createCandidate(),
      destinationId,
      'CREDENTIAL_GATE',
    );
    const plainFailed = await createFailedPublication(await createCandidate(), destinationId, null);
    const otherDestinationGate = await createFailedPublication(
      await createCandidate(),
      otherDestinationId,
      'CREDENTIAL_GATE',
    );

    const requeued = await txManager.run(async (tx) =>
      repo.requeueCredentialGateFailures(tx, destinationId),
    );

    expect(requeued).toEqual([gateBlocked]);

    const gateRow = await getPublication(gateBlocked);
    expect(gateRow.status).toBe('SCHEDULED');
    expect(gateRow.failure_category).toBeNull();
    expect(gateRow.scheduled_at).not.toBeNull();

    const plainRow = await getPublication(plainFailed);
    expect(plainRow.status).toBe('FAILED');
    expect(plainRow.failure_category).toBeNull();

    const otherRow = await getPublication(otherDestinationGate);
    expect(otherRow.status).toBe('FAILED');
    expect(otherRow.failure_category).toBe('CREDENTIAL_GATE');
  });

  it('second run is a no-op (idempotent by construction)', async () => {
    const gateBlocked = await createFailedPublication(
      await createCandidate(),
      destinationId,
      'CREDENTIAL_GATE',
    );

    const first = await txManager.run(async (tx) =>
      repo.requeueCredentialGateFailures(tx, destinationId),
    );
    expect(first).toEqual([gateBlocked]);

    const second = await txManager.run(async (tx) =>
      repo.requeueCredentialGateFailures(tx, destinationId),
    );
    expect(second).toEqual([]);

    const row = await getPublication(gateBlocked);
    expect(row.status).toBe('SCHEDULED');
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
    VALUES ('Requeue Test', 'META', ${marker})
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
