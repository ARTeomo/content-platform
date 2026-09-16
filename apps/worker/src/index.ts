import { createDatabaseClient, OutboxRepository } from '@content-platform/database';
import { loadWorkerConfig } from './config.js';
import { OutboxDispatcher } from './outbox-dispatcher.js';
import { BullMqJobQueue } from './queue/index.js';

/**
 * Worker entrypoint.
 *
 * Phase 16: runs the OutboxDispatcher only. Subsequent phases will add
 * the BullMQ workers for `webhook.process`, `webhook.respond`, and
 * other queues.
 */
async function main(): Promise<void> {
  const config = loadWorkerConfig();

  const db = createDatabaseClient({
    url: config.databaseUrl,
    applicationName: 'content-platform-worker',
  });

  const queue = new BullMqJobQueue({
    redisUrl: config.redisUrl,
    queueName: config.queuePrefix,
  });

  const outboxRepo = new OutboxRepository(db.db);
  const dispatcher = new OutboxDispatcher({
    outboxRepo,
    queue,
    config,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`[worker] received ${signal}, shutting down`);
    await dispatcher.stop();
    await queue.close();
    await db.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await dispatcher.start();
}

main().catch((err) => {
  console.error('[worker] fatal error:', err);
  process.exit(1);
});
