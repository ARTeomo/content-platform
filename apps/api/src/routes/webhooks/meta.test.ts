import { createHmac, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabaseClient, type DatabaseClient } from '@content-platform/database';
import { buildApp } from '../../app.js';
import type { ApiConfig } from '../../config.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const APP_SECRET = 'test-app-secret';
const VERIFY_KEY = randomBytes(32).toString('base64');

describe.skipIf(!TEST_DB_URL)('Meta webhook ingress', () => {
  let client: DatabaseClient;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let destinationId: string;

  beforeAll(async () => {
    client = createDatabaseClient({ url: TEST_DB_URL! });
    const config: ApiConfig = {
      host: '127.0.0.1',
      port: 0,
      databaseUrl: TEST_DB_URL!,
      metaAppSecret: APP_SECRET,
      webhookTokenEncryptionKey: VERIFY_KEY,
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
    await client.sql`TRUNCATE outbox_jobs, webhook_events RESTART IDENTITY CASCADE`;
  });

  function sign(body: string): string {
    return 'sha256=' + createHmac('sha256', APP_SECRET).update(body).digest('hex');
  }

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
});
