import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDatabaseClient,
  OutboxRepository,
  TransactionManager,
  type DatabaseClient,
} from '@content-platform/database';
import { Redis } from 'ioredis';
import { OutboxDispatcher } from './outbox-dispatcher.js';
import { BullMqJobQueue } from './queue/index.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const TEST_REDIS_URL = process.env.TEST_REDIS_URL;

describe.skipIf(!TEST_DB_URL || !TEST_REDIS_URL)('OutboxDispatcher', () => {
  let client: DatabaseClient;
  let outboxRepo: OutboxRepository;
  let txManager: TransactionManager;
  let queue: BullMqJobQueue;
  let redis: Redis;
  const queueName = 'test-outbox-dispatcher';

  beforeAll(async () => {
    client = createDatabaseClient({ url: TEST_DB_URL! });
    outboxRepo = new OutboxRepository(client.db);
    txManager = new TransactionManager(client.db);

    queue = new BullMqJobQueue({
      redisUrl: TEST_REDIS_URL!,
      queueName,
    });

    redis = new Redis(TEST_REDIS_URL!, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  });

  afterAll(async () => {
    await queue.close();
    await redis.quit();
    await client.close();
  });

  beforeEach(async () => {
    await client.sql`TRUNCATE outbox_jobs RESTART IDENTITY CASCADE`;
    // Flush only our BullMQ keys.
    const keys = await redis.keys(`bull:${queueName}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  afterEach(async () => {
    // Ensure timers do not leak between tests.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it('dispatches a PENDING job to the queue and marks it DISPATCHED', async () => {
    await txManager.run(async (tx) => {
      await outboxRepo.enqueue(tx, {
        queueName,
        jobId: 'test-job-1',
        payload: { webhookEventId: 'evt-1' },
      });
    });

    const dispatcher = new OutboxDispatcher({
      outboxRepo,
      queue,
      config: {
        outboxDispatchBatchSize: 10,
        outboxDispatchIdleBackoffMs: 100,
        outboxDispatchMaxAttempts: 5,
        outboxDispatchStaleThresholdSeconds: 60,
        outboxRecoveryIntervalSeconds: 3600,
        outboxCleanupRetentionDays: 7,
      },
    });

    const dispatched = await dispatcher.dispatchOnce();
    expect(dispatched).toBe(1);

    const rows = await client.sql<{ status: string }[]>`
      SELECT status FROM outbox_jobs WHERE job_id = 'test-job-1'
    `;
    expect(rows[0]!.status).toBe('DISPATCHED');
  });

  it('recovers stale DISPATCHING rows', async () => {
    await txManager.run(async (tx) => {
      await outboxRepo.enqueue(tx, {
        queueName,
        jobId: 'test-job-stale',
        payload: {},
      });
    });

    // Manually force the row into DISPATCHING with an old timestamp.
    await client.sql`
      UPDATE outbox_jobs
      SET status = 'DISPATCHING',
          last_attempt_at = now() - interval '10 minutes',
          attempts = 1
      WHERE job_id = 'test-job-stale'
    `;

    const recovered = await outboxRepo.recoverStale(60);
    expect(recovered).toBe(1);

    const rows = await client.sql<{ status: string }[]>`
      SELECT status FROM outbox_jobs WHERE job_id = 'test-job-stale'
    `;
    expect(rows[0]!.status).toBe('PENDING');
  });

  it('cleans up old DISPATCHED rows only', async () => {
    await txManager.run(async (tx) => {
      await outboxRepo.enqueue(tx, { queueName, jobId: 'old', payload: {} });
      await outboxRepo.enqueue(tx, { queueName, jobId: 'new', payload: {} });
    });

    await client.sql`
      UPDATE outbox_jobs
      SET status = 'DISPATCHED',
          dispatched_at = now() - interval '30 days'
      WHERE job_id = 'old'
    `;
    await client.sql`
      UPDATE outbox_jobs
      SET status = 'DISPATCHED',
          dispatched_at = now()
      WHERE job_id = 'new'
    `;

    const deleted = await outboxRepo.cleanupOlderThan(7);
    expect(deleted).toBe(1);

    const remaining = await client.sql<{ job_id: string }[]>`
      SELECT job_id FROM outbox_jobs
    `;
    expect(remaining.map((r) => r.job_id)).toEqual(['new']);
  });
});
