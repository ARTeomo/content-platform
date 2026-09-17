import Fastify, { type FastifyInstance } from 'fastify';
import type { DatabaseClient } from '@content-platform/database';
import { metaWebhookRoutes } from './routes/webhooks/meta.js';
import type { ApiConfig } from './config.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export interface BuildAppOptions {
  config: ApiConfig;
  client: DatabaseClient;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    request.rawBody = body as Buffer;
    try {
      done(null, JSON.parse((body as Buffer).toString('utf8')));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async (_req, reply) => {
    const dbOk = await options.client.healthCheck();
    if (!dbOk) return reply.code(503).send({ status: 'unready', database: false });
    return reply.code(200).send({ status: 'ready', database: true });
  });

  await app.register(metaWebhookRoutes, {
    config: options.config,
    client: options.client,
  });

  return app;
}
