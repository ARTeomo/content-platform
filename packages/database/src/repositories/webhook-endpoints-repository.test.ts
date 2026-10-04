import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabaseClient, type DatabaseClient } from '../client.js';
import { WebhookEndpointsRepository } from './webhook-endpoints-repository.js';
import { TransactionManager } from '../transaction/transaction-manager.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB_URL)('WebhookEndpointsRepository', () => {
  let client: DatabaseClient;
  let repo: WebhookEndpointsRepository;
  let txManager: TransactionManager;

  beforeAll(async () => {
    client = createDatabaseClient({ url: TEST_DB_URL! });
    repo = new WebhookEndpointsRepository(client.db);
    txManager = new TransactionManager(client.db);
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await client.sql`TRUNCATE webhook_endpoints, webhook_subscriptions CASCADE`;
  });

  it('creates an endpoint and reads it back by id', async () => {
    const created = await txManager.run(async (tx) =>
      repo.create(tx, {
        provider: 'META',
        name: 'content-platform-app',
        verifyTokenEncrypted: 'v1:AAAA',
        verifyTokenKeyVersion: 1,
      }),
    );
    expect(created.status).toBe('ACTIVE');
    expect(created.verifyTokenKeyVersion).toBe(1);

    const found = await repo.findById(created.id);
    expect(found?.id).toBe(created.id);
    expect(found?.provider).toBe('META');
    expect(found?.name).toBe('content-platform-app');
  });

  it('enforces unique (provider, name)', async () => {
    await txManager.run(async (tx) =>
      repo.create(tx, {
        provider: 'META',
        name: 'dup',
        verifyTokenEncrypted: 'v1:X',
        verifyTokenKeyVersion: 1,
      }),
    );
    await expect(
      txManager.run(async (tx) =>
        repo.create(tx, {
          provider: 'META',
          name: 'dup',
          verifyTokenEncrypted: 'v1:Y',
          verifyTokenKeyVersion: 1,
        }),
      ),
    ).rejects.toThrow();
  });

  it('findActiveByProvider returns only ACTIVE rows', async () => {
    await txManager.run(async (tx) =>
      repo.create(tx, {
        provider: 'META',
        name: 'active-one',
        verifyTokenEncrypted: 'v1:A',
        verifyTokenKeyVersion: 1,
        status: 'ACTIVE',
      }),
    );
    const paused = await txManager.run(async (tx) =>
      repo.create(tx, {
        provider: 'META',
        name: 'paused-one',
        verifyTokenEncrypted: 'v1:B',
        verifyTokenKeyVersion: 1,
        status: 'PAUSED',
      }),
    );

    const active = await repo.findActiveByProvider('META');
    expect(active).toHaveLength(1);
    expect(active[0]!.name).toBe('active-one');

    const found = await repo.findById(paused.id);
    expect(found?.status).toBe('PAUSED');
  });

  it('updateStatus changes the status', async () => {
    const created = await txManager.run(async (tx) =>
      repo.create(tx, {
        provider: 'META',
        name: 'toggle',
        verifyTokenEncrypted: 'v1:C',
        verifyTokenKeyVersion: 1,
      }),
    );
    await txManager.run(async (tx) => repo.updateStatus(tx, created.id, 'DISABLED'));
    const found = await repo.findById(created.id);
    expect(found?.status).toBe('DISABLED');
  });

  it('touchVerifiedAt stamps last_verified_at', async () => {
    const created = await txManager.run(async (tx) =>
      repo.create(tx, {
        provider: 'META',
        name: 'verify',
        verifyTokenEncrypted: 'v1:D',
        verifyTokenKeyVersion: 1,
      }),
    );
    const at = new Date('2026-10-04T12:00:00Z');
    await txManager.run(async (tx) => repo.touchVerifiedAt(tx, created.id, at));
    const found = await repo.findById(created.id);
    expect(found?.lastVerifiedAt).toEqual(at);
  });

  it('updateVerifyToken replaces ciphertext and key version', async () => {
    const created = await txManager.run(async (tx) =>
      repo.create(tx, {
        provider: 'META',
        name: 'rotate',
        verifyTokenEncrypted: 'v1:OLD',
        verifyTokenKeyVersion: 1,
      }),
    );
    const at = new Date('2026-10-04T13:00:00Z');
    await txManager.run(async (tx) => repo.updateVerifyToken(tx, created.id, 'v1:NEW', 2, at));
    const found = await repo.findById(created.id);
    expect(found?.verifyTokenEncrypted).toBe('v1:NEW');
    expect(found?.verifyTokenKeyVersion).toBe(2);
    expect(found?.lastRotatedAt).toEqual(at);
  });
});
