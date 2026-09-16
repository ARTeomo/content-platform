import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDatabaseClient,
  ProviderCredentialsRepository,
  TransactionManager,
  type DatabaseClient,
} from '@content-platform/database';
import { CredentialEncryptionProvider } from '../encryption/index.js';
import { MetaCredentialService } from './meta-credential-service.js';
import { MetaGraphApiError } from './meta-error-mapper.js';
import {
  type LongLivedTokenResponse,
  type MetaGraphClient,
  type MetaMeResponse,
  type ExchangeTokenInput,
} from './meta-graph-client.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

class FakeMetaGraphClient implements MetaGraphClient {
  public exchangeResponse: LongLivedTokenResponse | null = null;
  public exchangeError: Error | null = null;
  public validateResponse: MetaMeResponse | null = null;
  public validateError: Error | null = null;
  public exchangeCalls: ExchangeTokenInput[] = [];
  public validateCalls: string[] = [];

  async exchangeForLongLivedToken(input: ExchangeTokenInput): Promise<LongLivedTokenResponse> {
    this.exchangeCalls.push(input);
    if (this.exchangeError) throw this.exchangeError;
    if (!this.exchangeResponse) throw new Error('exchangeResponse not configured');
    return this.exchangeResponse;
  }

  async validateAccessToken(accessToken: string): Promise<MetaMeResponse> {
    this.validateCalls.push(accessToken);
    if (this.validateError) throw this.validateError;
    if (!this.validateResponse) throw new Error('validateResponse not configured');
    return this.validateResponse;
  }
}

describe.skipIf(!TEST_DB_URL)('MetaCredentialService', () => {
  let client: DatabaseClient;
  let service: MetaCredentialService;
  let repo: ProviderCredentialsRepository;
  let graphClient: FakeMetaGraphClient;
  let destinationId: string;

  beforeAll(async () => {
    client = createDatabaseClient({ url: TEST_DB_URL! });
    repo = new ProviderCredentialsRepository(client.db);
    const txManager = new TransactionManager(client.db);

    const keys = new Map<number, Buffer>();
    keys.set(1, randomBytes(32));
    const encryption = new CredentialEncryptionProvider({ keys, activeVersion: 1 });

    graphClient = new FakeMetaGraphClient();

    service = new MetaCredentialService(txManager, repo, encryption, graphClient, {
      appId: 'test-app-id',
      appSecret: 'test-app-secret',
    });

    destinationId = await ensureDestination(client, 'test-meta-cred-destination');
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await client.sql`TRUNCATE provider_credentials RESTART IDENTITY CASCADE`;
    graphClient.exchangeResponse = null;
    graphClient.exchangeError = null;
    graphClient.validateResponse = null;
    graphClient.validateError = null;
    graphClient.exchangeCalls = [];
    graphClient.validateCalls = [];
  });

  it('storeCredential encrypts the value and getCredential decrypts it', async () => {
    const stored = await service.storeCredential({
      scope: 'DESTINATION',
      destinationId,
      credentialType: 'PAGE_ACCESS_TOKEN',
      plaintextValue: 'EAAG-secret-token',
      status: 'VALID',
    });

    expect(stored.encryptedValue.startsWith('v1:')).toBe(true);
    expect(stored.encryptedValue).not.toContain('EAAG-secret-token');

    const retrieved = await service.getCredential({
      provider: 'META',
      credentialType: 'PAGE_ACCESS_TOKEN',
      destinationId,
    });

    expect(retrieved).not.toBeNull();
    expect(retrieved!.value).toBe('EAAG-secret-token');
    expect(retrieved!.status).toBe('VALID');
  });

  it('getCredential returns null for a missing credential', async () => {
    const retrieved = await service.getCredential({
      provider: 'META',
      credentialType: 'PAGE_ACCESS_TOKEN',
      destinationId,
    });
    expect(retrieved).toBeNull();
  });

  it('storeCredential rejects an empty plaintextValue', async () => {
    await expect(
      service.storeCredential({
        scope: 'APP',
        destinationId: null,
        credentialType: 'APP_SECRET',
        plaintextValue: '',
      }),
    ).rejects.toThrowError(/plaintextValue must not be empty/);
  });

  it('rotateCredential exchanges the current value and persists the new one', async () => {
    await service.storeCredential({
      scope: 'DESTINATION',
      destinationId,
      credentialType: 'PAGE_ACCESS_TOKEN',
      plaintextValue: 'short-lived-token',
      status: 'VALID',
    });

    graphClient.exchangeResponse = {
      accessToken: 'long-lived-token',
      tokenType: 'bearer',
      expiresIn: 5183944,
    };

    const rotated = await service.rotateCredential({
      provider: 'META',
      credentialType: 'PAGE_ACCESS_TOKEN',
      destinationId,
      reason: 'scheduled_refresh',
    });

    expect(graphClient.exchangeCalls).toHaveLength(1);
    expect(graphClient.exchangeCalls[0]!.shortLivedToken).toBe('short-lived-token');
    expect(graphClient.exchangeCalls[0]!.appId).toBe('test-app-id');
    expect(graphClient.exchangeCalls[0]!.appSecret).toBe('test-app-secret');

    expect(rotated.status).toBe('VALID');
    expect(rotated.rotationReason).toBe('scheduled_refresh');
    expect(rotated.expiresAt).toBeInstanceOf(Date);

    const retrieved = await service.getCredential({
      provider: 'META',
      credentialType: 'PAGE_ACCESS_TOKEN',
      destinationId,
    });
    expect(retrieved!.value).toBe('long-lived-token');
  });

  it('rotateCredential throws when the credential does not exist', async () => {
    await expect(
      service.rotateCredential({
        provider: 'META',
        credentialType: 'PAGE_ACCESS_TOKEN',
        destinationId,
        reason: 'manual',
      }),
    ).rejects.toThrowError(/No PAGE_ACCESS_TOKEN credential/);
  });

  it('invalidateCredential marks the row as INVALID', async () => {
    await service.storeCredential({
      scope: 'DESTINATION',
      destinationId,
      credentialType: 'PAGE_ACCESS_TOKEN',
      plaintextValue: 'token',
      status: 'VALID',
    });

    await service.invalidateCredential({
      provider: 'META',
      credentialType: 'PAGE_ACCESS_TOKEN',
      destinationId,
      reason: 'graph_api_401',
    });

    const retrieved = await service.getCredential({
      provider: 'META',
      credentialType: 'PAGE_ACCESS_TOKEN',
      destinationId,
    });
    expect(retrieved!.status).toBe('INVALID');
  });

  it('invalidateCredential is a no-op for a missing credential', async () => {
    await expect(
      service.invalidateCredential({
        provider: 'META',
        credentialType: 'PAGE_ACCESS_TOKEN',
        destinationId,
        reason: 'noop',
      }),
    ).resolves.toBeUndefined();
  });

  it('validateCredential returns VALID on success and updates the row', async () => {
    await service.storeCredential({
      scope: 'DESTINATION',
      destinationId,
      credentialType: 'PAGE_ACCESS_TOKEN',
      plaintextValue: 'token',
      status: 'UNKNOWN',
    });

    graphClient.validateResponse = { id: 'page-123', name: 'Test Page' };

    const result = await service.validateCredential({
      provider: 'META',
      credentialType: 'PAGE_ACCESS_TOKEN',
      destinationId,
    });

    expect(result.status).toBe('VALID');
    expect(result.errorCategory).toBeUndefined();

    const retrieved = await service.getCredential({
      provider: 'META',
      credentialType: 'PAGE_ACCESS_TOKEN',
      destinationId,
    });
    expect(retrieved!.status).toBe('VALID');
    expect(retrieved!.lastValidatedAt).toBeInstanceOf(Date);
  });

  it('validateCredential returns INVALID on authentication error', async () => {
    await service.storeCredential({
      scope: 'DESTINATION',
      destinationId,
      credentialType: 'PAGE_ACCESS_TOKEN',
      plaintextValue: 'token',
      status: 'VALID',
    });

    graphClient.validateError = new MetaGraphApiError({
      message: 'Invalid OAuth access token',
      httpStatus: 400,
      code: 190,
    });

    const result = await service.validateCredential({
      provider: 'META',
      credentialType: 'PAGE_ACCESS_TOKEN',
      destinationId,
    });

    expect(result.status).toBe('INVALID');
    expect(result.errorCategory).toBe('AUTHENTICATION_ERROR');

    const retrieved = await service.getCredential({
      provider: 'META',
      credentialType: 'PAGE_ACCESS_TOKEN',
      destinationId,
    });
    expect(retrieved!.status).toBe('INVALID');
  });

  it('validateCredential preserves status on transient error', async () => {
    await service.storeCredential({
      scope: 'DESTINATION',
      destinationId,
      credentialType: 'PAGE_ACCESS_TOKEN',
      plaintextValue: 'token',
      status: 'VALID',
    });

    graphClient.validateError = new MetaGraphApiError({
      message: 'Unknown server error',
      httpStatus: 500,
      code: 1,
    });

    const result = await service.validateCredential({
      provider: 'META',
      credentialType: 'PAGE_ACCESS_TOKEN',
      destinationId,
    });

    expect(result.status).toBe('VALID');
    expect(result.errorCategory).toBe('TRANSIENT_ERROR');

    const retrieved = await service.getCredential({
      provider: 'META',
      credentialType: 'PAGE_ACCESS_TOKEN',
      destinationId,
    });
    expect(retrieved!.status).toBe('VALID');
    expect(retrieved!.lastValidatedAt).toBeInstanceOf(Date);
  });

  it('validateCredential returns UNKNOWN when the credential does not exist', async () => {
    const result = await service.validateCredential({
      provider: 'META',
      credentialType: 'PAGE_ACCESS_TOKEN',
      destinationId,
    });

    expect(result.status).toBe('UNKNOWN');
    expect(result.errorCategory).toBe('CREDENTIAL_NOT_FOUND');
  });

  it('healthCheck aggregates the worst status across credentials', async () => {
    await service.storeCredential({
      scope: 'DESTINATION',
      destinationId,
      credentialType: 'PAGE_ACCESS_TOKEN',
      plaintextValue: 'valid-token',
      status: 'VALID',
    });

    const txManager = new TransactionManager(client.db);
    await txManager.run(async (tx) => {
      await repo.upsert(tx, {
        scope: 'DESTINATION',
        destinationId,
        provider: 'META',
        credentialType: 'APP_SECRET',
        encryptedValue: 'v1:AAAA',
        encryptionKeyVersion: 1,
        status: 'EXPIRING',
      });
    });

    const report = await service.healthCheck(destinationId);
    expect(report.destinationId).toBe(destinationId);
    expect(report.overall).toBe('EXPIRING');
    expect(report.credentials).toHaveLength(2);
  });

  it('healthCheck returns UNKNOWN when there are no credentials', async () => {
    const report = await service.healthCheck(destinationId);
    expect(report.overall).toBe('UNKNOWN');
    expect(report.credentials).toHaveLength(0);
  });
});

async function ensureDestination(client: DatabaseClient, marker: string): Promise<string> {
  const existing = await client.sql<{ id: string }[]>`
    SELECT id FROM destinations WHERE external_id = ${marker}
  `;
  if (existing[0]) return existing[0].id;

  const [destination] = await client.sql<{ id: string }[]>`
    INSERT INTO destinations (name, type, external_id)
    VALUES ('Test Meta Credential Destination', 'META', ${marker})
    RETURNING id
  `;
  if (!destination) throw new Error('scaffolding: destination insert failed');
  return destination.id;
}
