import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDatabaseClient, type DatabaseClient } from '../client.js';
import { OutboxRepository } from './outbox-repository.js';
import { TransactionManager } from '../transaction/transaction-manager.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

/**
 * Integration tests for OutboxRepository.
 *
 * These tests require a PostgreSQL database with the schema applied.
 * They are skipped when TEST_DATABASE_URL is not set.
 *
 * To run:
 *   TEST_DATABASE_URL=postgresql://... pnpm test
 */
describe.skipIf(!TEST_DB_URL)('OutboxRepository', () => {
  let client: DatabaseClient;
  let repo: OutboxRepository;
  let txManager: TransactionManager;

  beforeAll(async () => {
    client = createDatabaseClient({ url: TEST_DB_URL! });
    repo = new OutboxRepository(client.db);
    txManager = new TransactionManager(client.db);
    await client.sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await client.sql`TRUNCATE outbox_jobs`;
  });

  it('enqueues a job inside a transaction', async () => {
    await txManager.run(async (tx) => {
      await repo.enqueue(tx, {
        queueName: 'test.queue',
        jobId: 'test.job.1',
        payload: { id: 'abc' },
      });
    });

    const rows = await client.sql`SELECT * FROM outbox_jobs WHERE job_id = 'test.job.1'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('PENDING');
  });

  it('rolls back the enqueue when the transaction fails', async () => {
    await expect(
      txManager.run(async (tx) => {
        await repo.enqueue(tx, {
          queueName: 'test.queue',
          jobId: 'test.job.rollback',
          payload: {},
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    const rows = await client.sql`SELECT * FROM outbox_jobs WHERE job_id = 'test.job.rollback'`;
    expect(rows).toHaveLength(0);
  });

  it('claims a pending batch and marks it DISPATCHING', async () => {
    await txManager.run(async (tx) => {
      await repo.enqueue(tx, { queueName: 'q', jobId: 'j1', payload: {} });
      await repo.enqueue(tx, { queueName: 'q', jobId: 'j2', payload: {} });
    });

    const claimed = await repo.claimPendingBatch(10);
    expect(claimed).toHaveLength(2);
    expect(claimed.every((j) => j.status === 'DISPATCHING')).toBe(true);
    expect(claimed.every((j) => j.attempts === 1)).toBe(true);
  });

  it('marks a claimed job as dispatched', async () => {
    await txManager.run(async (tx) => {
      await repo.enqueue(tx, { queueName: 'q', jobId: 'j1', payload: {} });
    });

    const [claimed] = await repo.claimPendingBatch(1);
    expect(claimed).toBeDefined();
    await repo.markDispatched(claimed!.id);

    const rows =
      await client.sql`SELECT status, dispatched_at FROM outbox_jobs WHERE id = ${claimed!.id}`;
    expect(rows[0]!.status).toBe('DISPATCHED');
    expect(rows[0]!.dispatched_at).not.toBeNull();
  });

  it('recovers stale DISPATCHING rows', async () => {
    await txManager.run(async (tx) => {
      await repo.enqueue(tx, { queueName: 'q', jobId: 'j1', payload: {} });
    });

    await repo.claimPendingBatch(1);
    // Force last_attempt_at to be old
    await client.sql`UPDATE outbox_jobs SET last_attempt_at = now() - interval '10 minutes'`;

    const recovered = await repo.recoverStale(60);
    expect(recovered).toBe(1);

    const rows = await client.sql`SELECT status FROM outbox_jobs WHERE job_id = 'j1'`;
    expect(rows[0]!.status).toBe('PENDING');
  });

  it('deletes only DISPATCHED rows older than the retention window', async () => {
    await txManager.run(async (tx) => {
      await repo.enqueue(tx, { queueName: 'q', jobId: 'old', payload: {} });
      await repo.enqueue(tx, { queueName: 'q', jobId: 'new', payload: {} });
    });

    const claimed = await repo.claimPendingBatch(10);
    for (const job of claimed) {
      await repo.markDispatched(job.id);
    }
    // Force one row to be old
    await client.sql`UPDATE outbox_jobs SET dispatched_at = now() - interval '30 days' WHERE job_id = 'old'`;

    const deleted = await repo.cleanupOlderThan(7);
    expect(deleted).toBe(1);

    const remaining = await client.sql`SELECT job_id FROM outbox_jobs`;
    expect(remaining.map((r) => r.job_id)).toEqual(['new']);
  });
});
