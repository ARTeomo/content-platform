import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabaseClient, type DatabaseClient } from '../client.js';
import { ProviderCredentialsRepository } from './provider-credentials-repository.js';
import { TransactionManager } from '../transaction/transaction-manager.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB_URL)('ProviderCredentialsRepository', () => {
  let client: DatabaseClient;
  let repo: ProviderCredentialsRepository;
  let txManager: TransactionManager;
  let destinationId: string;
  let destinationId2: string;

  beforeAll(async () => {
    client = createDatabaseClient({ url: TEST_DB_URL! });
    repo = new ProviderCredentialsRepository(client.db);
    txManager = new TransactionManager(client.db);
    destinationId = await ensureDestination(client, 'test-credential-destination-1');
    destinationId2 = await ensureDestination(client, 'test-credential-destination-2');
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await client.sql`TRUNCATE provider_credentials RESTART IDENTITY CASCADE`;
  });

  it('inserts a new APP-scope credential', async () => {
    const row = await txManager.run(async (tx) =>
      repo.upsert(tx, {
        scope: 'APP',
        destinationId: null,
        provider: 'META',
        credentialType: 'APP_SECRET',
        encryptedValue: 'v1:AAAAAAAA',
        encryptionKeyVersion: 1,
      }),
    );

    expect(row.scope).toBe('APP');
    expect(row.destinationId).toBeNull();
    expect(row.status).toBe('UNKNOWN');
    expect(row.encryptedValue).toBe('v1:AAAAAAAA');
    expect(row.encryptionKeyVersion).toBe(1);
  });

  it('is idempotent for APP scope (COALESCE handles NULL destination_id)', async () => {
    await txManager.run(async (tx) =>
      repo.upsert(tx, {
        scope: 'APP',
        destinationId: null,
        provider: 'META',
        credentialType: 'APP_SECRET',
        encryptedValue: 'v1:FIRST',
        encryptionKeyVersion: 1,
      }),
    );

    await txManager.run(async (tx) =>
      repo.upsert(tx, {
        scope: 'APP',
        destinationId: null,
        provider: 'META',
        credentialType: 'APP_SECRET',
        encryptedValue: 'v1:SECOND',
        encryptionKeyVersion: 1,
        status: 'VALID',
      }),
    );

    const count = await client.sql<{ c: number }[]>`
      SELECT COUNT(*)::int AS c FROM provider_credentials
    `;
    expect(count[0]!.c).toBe(1);

    const found = await repo.findUnique({
      provider: 'META',
      credentialType: 'APP_SECRET',
      scope: 'APP',
      destinationId: null,
    });
    expect(found?.encryptedValue).toBe('v1:SECOND');
    expect(found?.status).toBe('VALID');
  });

  it('inserts a DESTINATION-scope credential', async () => {
    const expiresAt = new Date('2027-01-01T00:00:00Z');
    const row = await txManager.run(async (tx) =>
      repo.upsert(tx, {
        scope: 'DESTINATION',
        destinationId,
        provider: 'META',
        credentialType: 'PAGE_ACCESS_TOKEN',
        encryptedValue: 'v1:PAGE_TOKEN',
        encryptionKeyVersion: 1,
        status: 'VALID',
        expiresAt,
      }),
    );

    expect(row.scope).toBe('DESTINATION');
    expect(row.destinationId).toBe(destinationId);
    expect(row.expiresAt).toEqual(expiresAt);
  });

  it('keeps APP and DESTINATION scope rows separate for the same provider and type', async () => {
    await txManager.run(async (tx) =>
      repo.upsert(tx, {
        scope: 'APP',
        destinationId: null,
        provider: 'META',
        credentialType: 'APP_SECRET',
        encryptedValue: 'v1:APP',
        encryptionKeyVersion: 1,
      }),
    );

    await txManager.run(async (tx) =>
      repo.upsert(tx, {
        scope: 'DESTINATION',
        destinationId,
        provider: 'META',
        credentialType: 'PAGE_ACCESS_TOKEN',
        encryptedValue: 'v1:PAGE',
        encryptionKeyVersion: 1,
      }),
    );

    const count = await client.sql<{ c: number }[]>`
      SELECT COUNT(*)::int AS c FROM provider_credentials
    `;
    expect(count[0]!.c).toBe(2);
  });

  it('updates status and last_validated_at', async () => {
    const row = await txManager.run(async (tx) =>
      repo.upsert(tx, {
        scope: 'APP',
        destinationId: null,
        provider: 'META',
        credentialType: 'APP_SECRET',
        encryptedValue: 'v1:X',
        encryptionKeyVersion: 1,
      }),
    );

    const validatedAt = new Date('2026-09-16T12:00:00Z');
    await txManager.run(async (tx) => repo.updateStatus(tx, row.id, 'VALID', validatedAt));

    const found = await repo.findUnique({
      provider: 'META',
      credentialType: 'APP_SECRET',
      scope: 'APP',
      destinationId: null,
    });
    expect(found?.status).toBe('VALID');
    expect(found?.lastValidatedAt).toEqual(validatedAt);
  });

  it('records rotation with a new encrypted value and key version', async () => {
    const row = await txManager.run(async (tx) =>
      repo.upsert(tx, {
        scope: 'DESTINATION',
        destinationId,
        provider: 'META',
        credentialType: 'PAGE_ACCESS_TOKEN',
        encryptedValue: 'v1:OLD',
        encryptionKeyVersion: 1,
      }),
    );

    const newExpiry = new Date('2027-06-01T00:00:00Z');
    await txManager.run(async (tx) =>
      repo.recordRotation(tx, row.id, 'v1:NEW', 2, newExpiry, 'scheduled_refresh'),
    );

    const found = await repo.findUnique({
      provider: 'META',
      credentialType: 'PAGE_ACCESS_TOKEN',
      scope: 'DESTINATION',
      destinationId,
    });
    expect(found?.encryptedValue).toBe('v1:NEW');
    expect(found?.encryptionKeyVersion).toBe(2);
    expect(found?.status).toBe('VALID');
    expect(found?.rotationReason).toBe('scheduled_refresh');
    expect(found?.lastRotationAt).toBeInstanceOf(Date);
  });

  it('marks a credential as INVALID', async () => {
    const row = await txManager.run(async (tx) =>
      repo.upsert(tx, {
        scope: 'DESTINATION',
        destinationId,
        provider: 'META',
        credentialType: 'PAGE_ACCESS_TOKEN',
        encryptedValue: 'v1:X',
        encryptionKeyVersion: 1,
        status: 'VALID',
      }),
    );

    await txManager.run(async (tx) => repo.markInvalid(tx, row.id, 'graph_api_401'));

    const found = await repo.findUnique({
      provider: 'META',
      credentialType: 'PAGE_ACCESS_TOKEN',
      scope: 'DESTINATION',
      destinationId,
    });
    expect(found?.status).toBe('INVALID');
    expect(found?.rotationReason).toBe('graph_api_401');
  });

  it('findExpiringWithinDays returns only PAGE_ACCESS_TOKEN rows in the window', async () => {
    // Row A: expires in 3 days on destination 1 — in window
    await txManager.run(async (tx) =>
      repo.upsert(tx, {
        scope: 'DESTINATION',
        destinationId,
        provider: 'META',
        credentialType: 'PAGE_ACCESS_TOKEN',
        encryptedValue: 'v1:A',
        encryptionKeyVersion: 1,
        status: 'VALID',
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      }),
    );

    // Row B: expires in 30 days on destination 2 — out of window
    await txManager.run(async (tx) =>
      repo.upsert(tx, {
        scope: 'DESTINATION',
        destinationId: destinationId2,
        provider: 'META',
        credentialType: 'PAGE_ACCESS_TOKEN',
        encryptedValue: 'v1:B',
        encryptionKeyVersion: 1,
        status: 'VALID',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      }),
    );

    const expiring = await repo.findExpiringWithinDays(7);
    expect(expiring).toHaveLength(1);
    expect(expiring[0]!.encryptedValue).toBe('v1:A');
  });

  it('findByKeyVersionBelow returns rows with older key versions', async () => {
    await txManager.run(async (tx) =>
      repo.upsert(tx, {
        scope: 'APP',
        destinationId: null,
        provider: 'META',
        credentialType: 'APP_SECRET',
        encryptedValue: 'v1:OLD',
        encryptionKeyVersion: 1,
      }),
    );

    await txManager.run(async (tx) =>
      repo.upsert(tx, {
        scope: 'DESTINATION',
        destinationId,
        provider: 'META',
        credentialType: 'PAGE_ACCESS_TOKEN',
        encryptedValue: 'v1:NEW',
        encryptionKeyVersion: 2,
      }),
    );

    const oldRows = await repo.findByKeyVersionBelow(2);
    expect(oldRows).toHaveLength(1);
    expect(oldRows[0]!.encryptionKeyVersion).toBe(1);
  });
});

/**
 * Create a minimal destination for DESTINATION-scope credential tests.
 * Idempotent — uses the external_id marker to detect an existing row.
 */
async function ensureDestination(client: DatabaseClient, marker: string): Promise<string> {
  const existing = await client.sql<{ id: string }[]>`
    SELECT id FROM destinations WHERE external_id = ${marker}
  `;
  if (existing[0]) {
    return existing[0].id;
  }

  const [destination] = await client.sql<{ id: string }[]>`
    INSERT INTO destinations (name, type, external_id)
    VALUES ('Test Credential Destination', 'META', ${marker})
    RETURNING id
  `;
  if (!destination) throw new Error('scaffolding: destination insert failed');
  return destination.id;
}
