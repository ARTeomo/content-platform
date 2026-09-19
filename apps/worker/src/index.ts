import {
  createDatabaseClient,
  ExternalInteractionsRepository,
  InteractionResponseAttemptsRepository,
  InteractionResponsesRepository,
  OutboxRepository,
  PublicationsRepository,
  TransactionManager,
  WebhookDeliveriesRepository,
  WebhookEventsRepository,
} from '@content-platform/database';
import { MetaInteractionAdapter, NoopMetaRateLimiter } from '@content-platform/publishers';
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
import {
  MetaGraphBridge,
  WebhookRespondService,
  WebhookRespondWorker,
  type WebhookRespondJobData,
} from './interaction-response/index.js';

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

  // ---- webhook.process wiring ----

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

  // ---- webhook.respond wiring ----

  const responsesRepo = new InteractionResponsesRepository(db.db);
  const attemptsRepo = new InteractionResponseAttemptsRepository(db.db);
  const interactionsRepo = new ExternalInteractionsRepository(db.db);

  const metaGraphBridge = new MetaGraphBridge({
    apiVersion: config.metaGraphApiVersion,
  });

  const metaAdapter = new MetaInteractionAdapter(
    {
      graphClient: metaGraphBridge,
      rateLimiter: new NoopMetaRateLimiter(),
      getAccessToken: async (_destinationId: string): Promise<string> => {
        if (!config.metaPageAccessToken) {
          throw new Error('META_PAGE_ACCESS_TOKEN is not set');
        }
        return config.metaPageAccessToken;
      },
    },
    { apiVersion: config.metaGraphApiVersion },
  );

  const webhookRespondService = new WebhookRespondService({
    txManager,
    responsesRepo,
    attemptsRepo,
    interactionsRepo,
    adapter: metaAdapter,
  });

  const webhookRespondWorker = new WebhookRespondWorker({
    consumerFactory: (options) =>
      new BullMqJobConsumer<WebhookRespondJobData>({
        redisUrl: config.redisUrl,
        queueName: options.queueName,
        processor: options.processor,
        onFailed: (jobId, err) => {
          console.error(`[webhook.respond] job ${jobId ?? '<unknown>'} failed: ${err.message}`);
        },
        onError: (err) => {
          console.error(`[webhook.respond] consumer error: ${err.message}`);
        },
      }),
    service: webhookRespondService,
  });

  // ---- shutdown ----

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`[worker] received ${signal}, shutting down`);
    await webhookRespondWorker.close();
    await webhookProcessWorker.close();
    await dispatcher.stop();
    await queue.close();
    await db.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  if (!config.metaPageAccessToken) {
    console.warn(
      '[worker] META_PAGE_ACCESS_TOKEN is not set — webhook.respond will fail with AUTHENTICATION_ERROR on every response',
    );
  }

  console.info('[worker] started');
  await dispatcher.start();
}

main().catch((err) => {
  console.error('[worker] fatal error:', err);
  process.exit(1);
});
