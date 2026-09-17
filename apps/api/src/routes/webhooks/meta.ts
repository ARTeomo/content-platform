import { createDecipheriv, createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  OutboxRepository,
  TransactionManager,
  WebhookEventsRepository,
  type DatabaseClient,
} from '@content-platform/database';
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

interface SubscriptionRow {
  id: string;
  destination_id: string;
  verify_token_encrypted: string;
}

function decryptVerifyToken(ciphertext: string, keyBase64: string, aad: string): string {
  const [version, payloadB64] = ciphertext.split(':', 2);
  if (version !== 'v1' || !payloadB64) {
    throw new Error('Unsupported verify token ciphertext format');
  }
  const payload = Buffer.from(payloadB64, 'base64');
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(payload.length - 16);
  const encrypted = payload.subarray(12, payload.length - 16);

  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('WEBHOOK_TOKEN_ENCRYPTION_KEY must be 32 bytes base64');
  }

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export async function metaWebhookRoutes(
  app: FastifyInstance,
  options: MetaWebhookRouteOptions,
): Promise<void> {
  const { config, client } = options;
  const eventsRepo = new WebhookEventsRepository(client.db);
  const outboxRepo = new OutboxRepository(client.db);
  const txManager = new TransactionManager(client.db);

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
    const idempotencyKey = createHash('sha256')
      .update(`META:${rawBodyHash}`)
      .digest('hex');

    const externalObjectId = envelope.entry[0]?.id ?? 'unknown';
    const field = envelope.entry[0]?.changes[0]?.field;

    try {
      await txManager.run(async (tx) => {
        const result = await eventsRepo.insertIdempotent(tx, {
          provider: 'META',
          objectType: envelope.object,
          externalObjectId,
          idempotencyKey,
          rawPayload: envelope as unknown as Record<string, unknown>,
          rawBodyHash,
          ...(field !== undefined && { field }),
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

  app.get('/api/v1/webhooks/meta', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as HandshakeQuery;
    const mode = query['hub.mode'];
    const verifyToken = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode !== 'subscribe' || !verifyToken || !challenge) {
      return reply.code(400).send({ error: 'malformed_payload' });
    }

    const allActive = await client.sql<SubscriptionRow[]>`
      SELECT id, destination_id, verify_token_encrypted
      FROM webhook_subscriptions
      WHERE provider = 'META' AND status = 'ACTIVE'
    `;

    for (const sub of allActive) {
      try {
        const decrypted = decryptVerifyToken(
          sub.verify_token_encrypted,
          config.webhookTokenEncryptionKey,
          `META:${sub.destination_id}`,
        );
        if (decrypted === verifyToken) {
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
