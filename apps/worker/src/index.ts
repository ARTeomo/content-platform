import {
  createDatabaseClient,
  ExternalInteractionsRepository,
  OutboxRepository,
  PublicationsRepository,
  TransactionManager,
  WebhookDeliveriesRepository,
  WebhookEventsRepository,
} from '@content-platform/database';
import { loadWorkerConfig } from './config.js';
import { OutboxDispatcher } from './outbox-dispatcher.js';
import { BullMqJobConsumer, BullMqJobQueue } from './queue/index.js';
import {
  ChangeExtractorRegistry,
  FeedChangeExtractor,
  MentionChangeExtractor,
  WebhookProcessService,
  WebhookProcessWorker,
  type WebhookProcessJobData,
} from './webhook/index.js';

async function main(): Promise<void> {
  const config = loadWorkerConfig();

  const db = createDatabaseClient({
    url: config.databaseUrl,
    applicationName: 'content-platform-worker',
  });
  const txManager = new TransactionManager(db.db);

  const queue = new BullMqJobQueue({ redisUrl: config.redisUrl });

  const outboxRepo = new OutboxRepository(db.db);
  const dispatcher = new OutboxDispatcher({ outboxRepo, queue, config });

  const extractorRegistry = new ChangeExtractorRegistry()
    .register(new FeedChangeExtractor())
    .register(new MentionChangeExtractor());

  const webhookProcessService = new WebhookProcessService({
    txManager,
    eventsRepo: new WebhookEventsRepository(db.db),
    deliveriesRepo: new WebhookDeliveriesRepository(db.db),
    interactionsRepo: new ExternalInteractionsRepository(db.db),
    publicationsRepo: new PublicationsRepository(db.db),
    extractorRegistry,
  });

  const webhookProcessWorker = new WebhookProcessWorker({
    consumerFactory: (options) =>
      new BullMqJobConsumer<WebhookProcessJobData>({
        redisUrl: config.redisUrl,
        queueName: options.queueName,
        processor: options.processor,
        onFailed: (jobId, err) => {
          console.error(`[webhook.process] job ${jobId ?? '<unknown>'} failed: ${err.message}`);
        },
        onError: (err) => {
          console.error(`[webhook.process] consumer error: ${err.message}`);
        },
      }),
    service: webhookProcessService,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`[worker] received ${signal}, shutting down`);
    await webhookProcessWorker.close();
    await dispatcher.stop();
    await queue.close();
    await db.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  console.info('[worker] started');
  await dispatcher.start();
}

main().catch((err) => {
  console.error('[worker] fatal error:', err);
  process.exit(1);
});
