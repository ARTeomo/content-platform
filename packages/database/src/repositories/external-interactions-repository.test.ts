import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabaseClient, type DatabaseClient } from '../client.js';
import { ExternalInteractionsRepository } from './external-interactions-repository.js';
import { TransactionManager } from '../transaction/transaction-manager.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB_URL)('ExternalInteractionsRepository', () => {
  let client: DatabaseClient;
  let repo: ExternalInteractionsRepository;
  let txManager: TransactionManager;

  beforeAll(async () => {
    client = createDatabaseClient({ url: TEST_DB_URL! });
    repo = new ExternalInteractionsRepository(client.db);
    txManager = new TransactionManager(client.db);
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
    const publicationId = '00000000-0000-0000-0000-000000000001';

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
