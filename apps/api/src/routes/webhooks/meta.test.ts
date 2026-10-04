import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabaseClient, type DatabaseClient } from '@content-platform/database';
import { WebhookTokenEncryptionProvider } from '@content-platform/authentication';
import { buildApp } from '../../app.js';
import type { ApiConfig } from '../../config.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const APP_SECRET = 'test-app-secret';
const VERIFY_KEY_BYTES = randomBytes(32);

describe.skipIf(!TEST_DB_URL)('Meta webhook ingress', () => {
  let client: DatabaseClient;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let destinationId: string;
  let encryption: WebhookTokenEncryptionProvider;

  beforeAll(async () => {
    client = createDatabaseClient({ url: TEST_DB_URL! });
    const keySet = {
      keys: new Map([[1, VERIFY_KEY_BYTES]]),
      activeVersion: 1,
    };
    encryption = new WebhookTokenEncryptionProvider(keySet);

    const config: ApiConfig = {
      host: '127.0.0.1',
      port: 0,
      databaseUrl: TEST_DB_URL!,
      metaAppSecret: APP_SECRET,
      webhookTokenKeySet: keySet,
    };
    app = await buildApp({ config, client });

    const existing = await client.sql<{ id: string }[]>`
      SELECT id FROM destinations WHERE external_id = 'test-webhook-ingress'
    `;
    if (existing[0]) {
      destinationId = existing[0].id;
    } else {
      const [d] = await client.sql<{ id: string }[]>`
        INSERT INTO destinations (name, type, external_id)
        VALUES ('Test Webhook Ingress', 'META', 'test-webhook-ingress')
        RETURNING id
      `;
      destinationId = d!.id;
    }
  });

  afterAll(async () => {
    await app.close();
    await client.close();
  });

  beforeEach(async () => {
    await client.sql`TRUNCATE outbox_jobs, webhook_events, webhook_subscriptions, webhook_endpoints RESTART IDENTITY CASCADE`;
  });

  function sign(body: string): string {
    return 'sha256=' + createHmac('sha256', APP_SECRET).update(body).digest('hex');
  }

  // ---------------------------------------------------------------------
  // POST — event ingress
  // ---------------------------------------------------------------------

  it('rejects invalid signature with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/meta',
      payload: '{}',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=deadbeef' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects malformed envelope with 400', async () => {
    const body = JSON.stringify({ object: 'page', entry: 'not-an-array' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/meta',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('persists event and enqueues outbox job atomically', async () => {
    const body = JSON.stringify({
      object: 'page',
      entry: [{ id: 'page-1', time: 1, changes: [{ field: 'feed', value: { item: 'comment' } }] }],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/meta',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
    });
    expect(res.statusCode).toBe(200);

    const events = await client.sql<{ c: number }[]>`SELECT COUNT(*)::int AS c FROM webhook_events`;
    expect(events[0]!.c).toBe(1);
    const jobs = await client.sql<{ c: number }[]>`SELECT COUNT(*)::int AS c FROM outbox_jobs`;
    expect(jobs[0]!.c).toBe(1);
  });

  it('is idempotent on duplicate POST', async () => {
    const body = JSON.stringify({
      object: 'page',
      entry: [{ id: 'page-1', time: 1, changes: [{ field: 'feed', value: { item: 'comment' } }] }],
    });
    const headers = { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) };

    await app.inject({ method: 'POST', url: '/api/v1/webhooks/meta', payload: body, headers });
    await app.inject({ method: 'POST', url: '/api/v1/webhooks/meta', payload: body, headers });

    const events = await client.sql<{ c: number }[]>`SELECT COUNT(*)::int AS c FROM webhook_events`;
    expect(events[0]!.c).toBe(1);
    const jobs = await client.sql<{ c: number }[]>`SELECT COUNT(*)::int AS c FROM outbox_jobs`;
    expect(jobs[0]!.c).toBe(1);
  });

  // ---------------------------------------------------------------------
  // GET — hub.challenge handshake (v1.3 endpoint-scoped only)
  // ---------------------------------------------------------------------

  async function insertEndpoint(
    plaintextToken: string,
    overrides: {
      status?: 'ACTIVE' | 'PAUSED' | 'DISABLED';
      ciphertext?: string;
      keyVersion?: number;
    } = {},
  ): Promise<string> {
    const id = randomUUID();
    const encrypted = encryption.encryptForEndpoint(plaintextToken, id);
    await client.sql`
      INSERT INTO webhook_endpoints (
        id, provider, name, verify_token_encrypted,
        verify_token_key_version, status
      ) VALUES (
        ${id}, 'META', ${'test-endpoint-' + id.slice(0, 8)},
        ${overrides.ciphertext ?? encrypted.ciphertext},
        ${overrides.keyVersion ?? encrypted.keyVersion},
        ${overrides.status ?? 'ACTIVE'}
      )
    `;
    return id;
  }

  it('handshake: accepts the correct verify token and returns hub.challenge', async () => {
    await insertEndpoint('expected-token-123');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=expected-token-123&hub.challenge=challenge-abc',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('challenge-abc');

    const [row] = await client.sql<{ last_verified_at: Date | null }[]>`
      SELECT last_verified_at FROM webhook_endpoints LIMIT 1
    `;
    expect(row!.last_verified_at).not.toBeNull();
  });

  it('handshake: rejects a mismatched verify token with 403', async () => {
    await insertEndpoint('expected-token-123');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=challenge-abc',
    });

    expect(res.statusCode).toBe(403);
  });

  it('handshake: rejects malformed mode with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/webhooks/meta?hub.mode=unsubscribe&hub.verify_token=x&hub.challenge=c',
    });
    expect(res.statusCode).toBe(400);
  });

  it('handshake: ignores endpoints whose status is not ACTIVE', async () => {
    await insertEndpoint('paused-token', { status: 'PAUSED' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=paused-token&hub.challenge=c',
    });

    expect(res.statusCode).toBe(403);
  });

  it('handshake: rejects a ciphertext with an unknown key version', async () => {
    await insertEndpoint('anything', { ciphertext: 'v1:boguspayload', keyVersion: 99 });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=anything&hub.challenge=c',
    });

    expect(res.statusCode).toBe(403);
  });

  it('handshake: a later endpoint in the scan matches when the first does not', async () => {
    await insertEndpoint('first-token');
    await insertEndpoint('second-token');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=second-token&hub.challenge=c',
    });

    expect(res.statusCode).toBe(200);
  });
});
