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
  // v1.3 (D-013): the verify token is owned by webhook_endpoints, and the
  // AAD is META:WEBHOOK_VERIFY_TOKEN:<endpoint_id>. The legacy
  // subscription-scoped path was removed after migration 0017 (CONTRACT).
  // -------------------------------------------------------------------------
  app.get('/api/v1/webhooks/meta', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as HandshakeQuery;
    const mode = query['hub.mode'];
    const verifyToken = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode !== 'subscribe' || !verifyToken || !challenge) {
      return reply.code(400).send({ error: 'malformed_payload' });
    }

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

    return reply.code(403).send({ error: 'invalid_verify_token' });
  });
}
