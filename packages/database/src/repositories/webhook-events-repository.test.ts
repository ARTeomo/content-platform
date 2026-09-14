import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabaseClient, type DatabaseClient } from '../client.js';
import { OutboxRepository } from './outbox-repository.js';
import { WebhookEventsRepository } from './webhook-events-repository.js';
import { TransactionManager } from '../transaction/transaction-manager.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB_URL)('WebhookEventsRepository', () => {
  let client: DatabaseClient;
  let events: WebhookEventsRepository;
  let outbox: OutboxRepository;
  let txManager: TransactionManager;

  beforeAll(async () => {
    client = createDatabaseClient({ url: TEST_DB_URL! });
    events = new WebhookEventsRepository(client.db);
    outbox = new OutboxRepository(client.db);
    txManager = new TransactionManager(client.db);
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await client.sql`TRUNCATE webhook_deliveries, external_interactions, webhook_events, outbox_jobs RESTART IDENTITY CASCADE`;
  });

  it('inserts a new event and enqueues an outbox job atomically', async () => {
    await txManager.run(async (tx) => {
      const result = await events.insertIdempotent(tx, {
        provider: 'META',
        objectType: 'page',
        externalObjectId: 'page-1',
        idempotencyKey: 'hash-1',
        rawPayload: { foo: 'bar' },
        rawBodyHash: 'hash-1',
      });
      expect(result.inserted).toBe(true);

      await outbox.enqueue(tx, {
        queueName: 'webhook.process',
        jobId: `webhook.process:${result.event.id}`,
        payload: { webhookEventId: result.event.id },
      });
    });

    const eventCount = await client.sql`SELECT COUNT(*)::int AS c FROM webhook_events`;
    expect(eventCount[0]!.c).toBe(1);

    const outboxCount = await client.sql`SELECT COUNT(*)::int AS c FROM outbox_jobs`;
    expect(outboxCount[0]!.c).toBe(1);
  });

  it('is idempotent: duplicate idempotency key does not create a second row', async () => {
    await txManager.run(async (tx) => {
      const first = await events.insertIdempotent(tx, {
        provider: 'META',
        objectType: 'page',
        externalObjectId: 'page-1',
        idempotencyKey: 'hash-dup',
        rawPayload: { foo: 'bar' },
        rawBodyHash: 'hash-dup',
      });
      expect(first.inserted).toBe(true);
    });

    await txManager.run(async (tx) => {
      const second = await events.insertIdempotent(tx, {
        provider: 'META',
        objectType: 'page',
        externalObjectId: 'page-1',
        idempotencyKey: 'hash-dup',
        rawPayload: { foo: 'bar' },
        rawBodyHash: 'hash-dup',
      });
      expect(second.inserted).toBe(false);
      expect(second.event.id).toBeDefined();
    });

    const count = await client.sql`SELECT COUNT(*)::int AS c FROM webhook_events`;
    expect(count[0]!.c).toBe(1);
  });

  it('rolls back the event and the outbox job together', async () => {
    await expect(
      txManager.run(async (tx) => {
        const result = await events.insertIdempotent(tx, {
          provider: 'META',
          objectType: 'page',
          externalObjectId: 'page-1',
          idempotencyKey: 'hash-rollback',
          rawPayload: {},
          rawBodyHash: 'hash-rollback',
        });
        await outbox.enqueue(tx, {
          queueName: 'webhook.process',
          jobId: `webhook.process:${result.event.id}`,
          payload: { webhookEventId: result.event.id },
        });
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');

    const eventCount = await client.sql`SELECT COUNT(*)::int AS c FROM webhook_events`;
    expect(eventCount[0]!.c).toBe(0);

    const outboxCount = await client.sql`SELECT COUNT(*)::int AS c FROM outbox_jobs`;
    expect(outboxCount[0]!.c).toBe(0);
  });
});
