import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDatabaseClient,
  OutboxRepository,
  TransactionManager,
  type DatabaseClient,
} from '@content-platform/database';
import { SystemOutboxCleanupService } from './system-outbox-cleanup-service.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB_URL)('SystemOutboxCleanupService', () => {
  let client: DatabaseClient;
  let outboxRepo: OutboxRepository;
  let txManager: TransactionManager;
  let service: SystemOutboxCleanupService;

  beforeAll(async () => {
    client = createDatabaseClient({ url: TEST_DB_URL! });
    outboxRepo = new OutboxRepository(client.db);
    txManager = new TransactionManager(client.db);
    service = new SystemOutboxCleanupService({
      outboxRepo,
      defaultRetentionDays: 7,
    });
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await client.sql`TRUNCATE outbox_jobs RESTART IDENTITY CASCADE`;
  });

  it('returns 0 when there is nothing to clean up', async () => {
    const result = await service.cleanup({});
    expect(result.deleted).toBe(0);
  });

  it('deletes only DISPATCHED rows older than the retention window', async () => {
    await txManager.run(async (tx) => {
      await outboxRepo.enqueue(tx, { queueName: 'q', jobId: 'old', payload: {} });
      await outboxRepo.enqueue(tx, { queueName: 'q', jobId: 'fresh', payload: {} });
      await outboxRepo.enqueue(tx, { queueName: 'q', jobId: 'pending', payload: {} });
    });

    await client.sql`
      UPDATE outbox_jobs
      SET status = 'DISPATCHED', dispatched_at = now() - interval '30 days'
      WHERE job_id = 'old'
    `;
    await client.sql`
      UPDATE outbox_jobs
      SET status = 'DISPATCHED', dispatched_at = now()
      WHERE job_id = 'fresh'
    `;
    // 'pending' stays PENDING — should never be deleted by cleanup.

    const result = await service.cleanup({});
    expect(result.deleted).toBe(1);

    const remaining = await client.sql<{ job_id: string }[]>`
      SELECT job_id FROM outbox_jobs ORDER BY job_id
    `;
    expect(remaining.map((r) => r.job_id)).toEqual(['fresh', 'pending']);
  });

  it('honours a per-job retention override', async () => {
    await txManager.run(async (tx) => {
      await outboxRepo.enqueue(tx, { queueName: 'q', jobId: 'a', payload: {} });
    });

    await client.sql`
      UPDATE outbox_jobs
      SET status = 'DISPATCHED', dispatched_at = now() - interval '2 days'
      WHERE job_id = 'a'
    `;

    // Default retention is 7 days, so nothing is deleted.
    expect((await service.cleanup({})).deleted).toBe(0);

    // Explicit retention of 1 day deletes the row.
    expect((await service.cleanup({ retentionDays: 1 })).deleted).toBe(1);
  });
});
