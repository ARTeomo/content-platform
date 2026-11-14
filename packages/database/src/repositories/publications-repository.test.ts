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

  // ---------------------------------------------------------------------
  // Stale IN_PROGRESS detection and atomic claim (C-D5)
  // ---------------------------------------------------------------------

  async function createInProgressPublication(updatedAtAgoSeconds: number): Promise<string> {
    const candidate = await createCandidate();
    const created = await client.sql<{ id: string }[]>`
      INSERT INTO publications
        (publication_candidate_id, destination_id, status)
      VALUES
        (${candidate}, ${destinationId}, 'IN_PROGRESS')
      RETURNING id
    `;
    const id = created[0]!.id;
    await client.sql`
      UPDATE publications
      SET updated_at = now() - (${updatedAtAgoSeconds} * interval '1 second')
      WHERE id = ${id}
    `;
    return id;
  }

  it('findStaleInProgress returns only stale IN_PROGRESS publication ids', async () => {
    const stale = await createInProgressPublication(3_600);
    await createInProgressPublication(10); // fresh — excluded
    const scheduled = await client.sql<{ id: string }[]>`
      INSERT INTO publications
        (publication_candidate_id, destination_id, status, scheduled_at)
      VALUES
        (${await createCandidate()}, ${destinationId}, 'SCHEDULED', now())
      RETURNING id
    `;

    const ids = await repo.findStaleInProgress(300, 10);

    expect(ids).toEqual([stale]);
    void scheduled;
  });

  it('claimStaleInProgress atomically claims a stale IN_PROGRESS row as FAILED/CRASH_RECOVERY', async () => {
    const id = await createInProgressPublication(3_600);

    const claimed = await txManager.run(async (tx) => repo.claimStaleInProgress(tx, id, 300));
    expect(claimed).toBe(true);

    const row = await getPublication(id);
    expect(row.status).toBe('FAILED');
    expect(row.failure_category).toBe('CRASH_RECOVERY');
  });

  it('claimStaleInProgress refuses a fresh (non-stale) IN_PROGRESS row', async () => {
    const id = await createInProgressPublication(10);

    const claimed = await txManager.run(async (tx) => repo.claimStaleInProgress(tx, id, 300));
    expect(claimed).toBe(false);

    const row = await getPublication(id);
    expect(row.status).toBe('IN_PROGRESS');
    expect(row.failure_category).toBeNull();
  });

  it('claimStaleInProgress refuses a row that already left IN_PROGRESS', async () => {
    const id = await createInProgressPublication(3_600);
    await client.sql`
      UPDATE publications SET status = 'PUBLISHED', published_at = now() WHERE id = ${id}
    `;

    const claimed = await txManager.run(async (tx) => repo.claimStaleInProgress(tx, id, 300));
    expect(claimed).toBe(false);

    const row = await getPublication(id);
    expect(row.status).toBe('PUBLISHED');
    expect(row.failure_category).toBeNull();
  });

  it('claimStaleInProgress second run is a no-op (idempotent by construction)', async () => {
    const id = await createInProgressPublication(3_600);

    const first = await txManager.run(async (tx) => repo.claimStaleInProgress(tx, id, 300));
    const second = await txManager.run(async (tx) => repo.claimStaleInProgress(tx, id, 300));
    expect(first).toBe(true);
    expect(second).toBe(false);

    const row = await getPublication(id);
    expect(row.status).toBe('FAILED');
    expect(row.failure_category).toBe('CRASH_RECOVERY');
  });

  // ---------------------------------------------------------------------
  // Atomic success claim (C-D5 late-success race fix)
  // ---------------------------------------------------------------------

  async function claimPublishedFrom(id: string): Promise<boolean> {
    return await txManager.run(async (tx) =>
      repo.claimPublished(tx, id, 'ext-post-race', new Date('2026-11-14T12:00:00Z')),
    );
  }

  it('claimPublished succeeds from IN_PROGRESS and from FAILED + CRASH_RECOVERY only', async () => {
    // Own execution state: allowed.
    const inProgress = await createInProgressPublication(10);
    expect(await claimPublishedFrom(inProgress)).toBe(true);
    let row = await getPublication(inProgress);
    expect(row.status).toBe('PUBLISHED');
    expect(row.failure_category).toBeNull();

    // Crash-recovery-claimed row: the confirmed external post is
    // recorded rather than discarded.
    const recoveryClaimed = await createInProgressPublication(3_600);
    await txManager.run(async (tx) => repo.claimStaleInProgress(tx, recoveryClaimed, 300));
    expect(await claimPublishedFrom(recoveryClaimed)).toBe(true);
    row = await getPublication(recoveryClaimed);
    expect(row.status).toBe('PUBLISHED');
    expect(row.failure_category).toBeNull();

    // Second claim (already PUBLISHED): refused.
    expect(await claimPublishedFrom(recoveryClaimed)).toBe(false);
  });

  it('claimPublished refuses real failures, credential-gate failures, and RECONCILIATION rows', async () => {
    const plainFailed = await createFailedPublication(await createCandidate(), destinationId, null);
    const gateFailed = await createFailedPublication(
      await createCandidate(),
      destinationId,
      'CREDENTIAL_GATE',
    );
    const reconciliation = await createInProgressPublication(10);
    await client.sql`UPDATE publications SET status = 'RECONCILIATION' WHERE id = ${reconciliation}`;

    expect(await claimPublishedFrom(plainFailed)).toBe(false);
    expect(await claimPublishedFrom(gateFailed)).toBe(false);
    expect(await claimPublishedFrom(reconciliation)).toBe(false);

    expect((await getPublication(plainFailed)).status).toBe('FAILED');
    expect((await getPublication(gateFailed)).failure_category).toBe('CREDENTIAL_GATE');
    expect((await getPublication(reconciliation)).status).toBe('RECONCILIATION');
  });

  // ---------------------------------------------------------------------
  // Retry requeue claims and selection (C-D6)
  // ---------------------------------------------------------------------

  async function createRetryRow(attempts: number, updatedAtAgoSeconds: number): Promise<string> {
    const candidate = await createCandidate();
    const created = await client.sql<{ id: string }[]>`
      INSERT INTO publications
        (publication_candidate_id, destination_id, status)
      VALUES
        (${candidate}, ${destinationId}, 'RETRY')
      RETURNING id
    `;
    const id = created[0]!.id;
    for (let n = 1; n <= attempts; n++) {
      await client.sql`
        INSERT INTO publication_attempts
          (publication_id, attempt_number, status, started_at, finished_at)
        VALUES (${id}, ${n}, 'FAILED', now(), now())
      `;
    }
    await client.sql`
      UPDATE publications
      SET updated_at = now() - (${updatedAtAgoSeconds} * interval '1 second')
      WHERE id = ${id}
    `;
    return id;
  }

  it('findRetryCandidates returns only RETRY rows with max attempts, ordered by updated_at', async () => {
    const older = await createRetryRow(2, 3_000);
    const newer = await createRetryRow(0, 100);
    await createInProgressPublication(3_600); // not RETRY — excluded

    const candidates = await repo.findRetryCandidates(10);

    expect(candidates.map((c) => c.id)).toEqual([older, newer]);
    expect(candidates[0]!.maxAttempt).toBe(2);
    expect(candidates[1]!.maxAttempt).toBe(0);
  });

  it('claimRetryDue flips a due, under-bound RETRY row to SCHEDULED and refuses not-yet-due or at-bound rows', async () => {
    const due = await createRetryRow(1, 120);
    const fresh = await createRetryRow(1, 10);
    const atBound = await createRetryRow(5, 120);

    expect(await txManager.run(async (tx) => repo.claimRetryDue(tx, due, 5, 60))).toBe(true);
    const row = await getPublication(due);
    expect(row.status).toBe('SCHEDULED');
    expect(row.failure_category).toBeNull();
    expect(row.scheduled_at).not.toBeNull();

    expect(await txManager.run(async (tx) => repo.claimRetryDue(tx, fresh, 5, 60))).toBe(false);
    expect((await getPublication(fresh)).status).toBe('RETRY');

    expect(await txManager.run(async (tx) => repo.claimRetryDue(tx, atBound, 5, 60))).toBe(false);
    expect((await getPublication(atBound)).status).toBe('RETRY');
  });

  it('claimRetryExhausted flips an at-bound RETRY row to FAILED/RETRY_EXHAUSTED, idempotently', async () => {
    const atBound = await createRetryRow(5, 30); // not due — exhaustion must still fire
    const belowBound = await createRetryRow(4, 120);

    expect(await txManager.run(async (tx) => repo.claimRetryExhausted(tx, atBound, 5))).toBe(true);
    const row = await getPublication(atBound);
    expect(row.status).toBe('FAILED');
    expect(row.failure_category).toBe('RETRY_EXHAUSTED');

    expect(await txManager.run(async (tx) => repo.claimRetryExhausted(tx, atBound, 5))).toBe(false);
    expect(await txManager.run(async (tx) => repo.claimRetryExhausted(tx, belowBound, 5))).toBe(
      false,
    );
    expect((await getPublication(belowBound)).status).toBe('RETRY');
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
