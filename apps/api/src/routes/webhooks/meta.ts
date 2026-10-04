import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  OutboxRepository,
  TransactionManager,
  WebhookEventsRepository,
  sql,
  type DatabaseClient,
} from '@content-platform/database';
import { WebhookTokenEncryptionProvider } from '@content-platform/authentication';
import { verifyMetaSignature } from './signature.js';
import { MetaWebhookEnvelopeSchema } from './envelope.js';
import type { ApiConfig } from '../../config.js';

interface MetaWebhookRouteOptions {
  config: ApiConfig;
  client: DatabaseClient;
}

interface HandshakeQuery {
  'hub.mode'?: string;
  'hub.verify_token'?: string;
  'hub.challenge'?: string;
}

interface EndpointRow {
  id: string;
  verify_token_encrypted: string;
  verify_token_key_version: number;
}

interface SubscriptionRow {
  id: string;
  destination_id: string;
  verify_token_encrypted: string;
  verify_token_key_version: number;
}

export async function metaWebhookRoutes(
  app: FastifyInstance,
  options: MetaWebhookRouteOptions,
): Promise<void> {
  const { config, client } = options;
  const eventsRepo = new WebhookEventsRepository(client.db);
  const outboxRepo = new OutboxRepository(client.db);
  const txManager = new TransactionManager(client.db);
  const webhookTokenEncryption = new WebhookTokenEncryptionProvider(config.webhookTokenKeySet);

  // -------------------------------------------------------------------------
  // POST — webhook event ingress
  //
  // Single database transaction per HTTP request:
  //   1. Resolve the destination from the Meta Page ID.
  //   2. Insert webhook_events idempotently.
  //   3. Enqueue outbox job if the event was newly inserted.
  //
  // Signature verification, JSON parsing, and Zod validation all run
  // before the transaction and touch no database state. No Redis call
  // occurs on the hot path.
  // -------------------------------------------------------------------------
  app.post('/api/v1/webhooks/meta', async (request: FastifyRequest, reply: FastifyReply) => {
    const rawBody = request.rawBody;
    if (!rawBody) {
      return reply.code(400).send({ error: 'malformed_payload' });
    }

    const signature = request.headers['x-hub-signature-256'] as string | undefined;
    if (!verifyMetaSignature(rawBody, signature, config.metaAppSecret)) {
      return reply.code(401).send({ error: 'invalid_signature' });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return reply.code(400).send({ error: 'malformed_payload' });
    }

    const parsed = MetaWebhookEnvelopeSchema.safeParse(payload);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'malformed_payload' });
    }

    const envelope = parsed.data;
    const rawBodyHash = createHash('sha256').update(rawBody).digest('hex');
    const idempotencyKey = createHash('sha256').update(`META:${rawBodyHash}`).digest('hex');

    const externalObjectId = envelope.entry[0]?.id ?? 'unknown';
    const field = envelope.entry[0]?.changes[0]?.field;

    try {
      await txManager.run(async (tx) => {
        const destinationRows = (await tx.execute(sql`
          SELECT id FROM destinations
          WHERE type = 'META' AND external_id = ${externalObjectId}
          LIMIT 1
        `)) as unknown as Array<{ id: string }>;
        const destinationId = destinationRows[0]?.id ?? null;

        const result = await eventsRepo.insertIdempotent(tx, {
          provider: 'META',
          objectType: envelope.object,
          externalObjectId,
          idempotencyKey,
          rawPayload: envelope as unknown as Record<string, unknown>,
          rawBodyHash,
          ...(field !== undefined && { field }),
          ...(destinationId !== null && { destinationId }),
        });

        if (result.inserted) {
          await outboxRepo.enqueue(tx, {
            queueName: 'webhook.process',
            jobId: `webhook.process:${result.event.id}`,
            payload: { webhookEventId: result.event.id },
            traceId: result.event.traceId,
          });
        }
      });
    } catch {
      return reply.code(500).send({ error: 'internal' });
    }

    return reply.code(200).send({ status: 'ok' });
  });

  // -------------------------------------------------------------------------
  // GET — Meta hub.challenge handshake
  //
  // Meta sends this when the webhook subscription is created or
  // re-verified. Each active subscription is checked; the first one
  // whose verify token matches the incoming query parameter wins.
  //
  // The verify token is decrypted using the key version stored on the
  // subscription row, which enables key rotation without a coordinated
  // downtime.
  // -------------------------------------------------------------------------
  app.get('/api/v1/webhooks/meta', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as HandshakeQuery;
    const mode = query['hub.mode'];
    const verifyToken = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode !== 'subscribe' || !verifyToken || !challenge) {
      return reply.code(400).send({ error: 'malformed_payload' });
    }

    // ---- v1.3 D-013b dual-read, phase 1: endpoint-scoped AAD ----
    //
    // The v1.3 AAD is META:WEBHOOK_VERIFY_TOKEN:<endpoint_id>. App-level
    // endpoints are checked first; if any endpoint matches, the
    // handshake succeeds and the subscription path is skipped.
    const activeEndpoints = await client.sql<EndpointRow[]>`
      SELECT id, verify_token_encrypted, verify_token_key_version
      FROM webhook_endpoints
      WHERE provider = 'META' AND status = 'ACTIVE'
    `;

    for (const ep of activeEndpoints) {
      try {
        const decrypted = webhookTokenEncryption.decryptForEndpoint(
          {
            ciphertext: ep.verify_token_encrypted,
            keyVersion: ep.verify_token_key_version,
          },
          ep.id,
        );

        if (webhookTokenEncryption.safeEqual(decrypted, verifyToken)) {
          await client.sql`
            UPDATE webhook_endpoints
            SET last_verified_at = now(), updated_at = now()
            WHERE id = ${ep.id}
          `;
          return reply.code(200).type('text/plain').send(challenge);
        }
      } catch {
        continue;
      }
    }

    // ---- v1.3 D-013b dual-read, phase 2: legacy subscription-scoped AAD ----
    //
    // The v1.1/v1.2 AAD is META:WEBHOOK_VERIFY_TOKEN:<destination_id>.
    // Active only during the dual-read window; removed after migration
    // 0017 (D-013c).
    const allActive = await client.sql<SubscriptionRow[]>`
      SELECT id, destination_id, verify_token_encrypted, verify_token_key_version
      FROM webhook_subscriptions
      WHERE provider = 'META' AND status = 'ACTIVE'
    `;

    for (const sub of allActive) {
      try {
        const decrypted = webhookTokenEncryption.decrypt(
          {
            ciphertext: sub.verify_token_encrypted,
            keyVersion: sub.verify_token_key_version,
          },
          sub.destination_id,
        );

        if (webhookTokenEncryption.safeEqual(decrypted, verifyToken)) {
          await client.sql`
            UPDATE webhook_subscriptions
            SET last_verified_at = now(), updated_at = now()
            WHERE id = ${sub.id}
          `;
          return reply.code(200).type('text/plain').send(challenge);
        }
      } catch {
        continue;
      }
    }

    return reply.code(403).send({ error: 'invalid_verify_token' });
  });
}
