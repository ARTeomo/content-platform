import {
  createDatabaseClient,
  DestinationsRepository,
  ExternalInteractionsRepository,
  InteractionResponseAttemptsRepository,
  InteractionResponseReconciliationsRepository,
  InteractionResponsesRepository,
  OutboxRepository,
  PublicationAttemptsRepository,
  PublicationReconciliationsRepository,
  PublicationsRepository,
  TransactionManager,
  WebhookDeliveriesRepository,
  WebhookEventsRepository,
} from '@content-platform/database';
import {
  MetaInteractionAdapter,
  MetaPublicationReconciler,
  MetaPublisherAdapter,
  MetaResponseReconciler,
  NoopMetaRateLimiter,
} from '@content-platform/publishers';
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
  InteractionResponseService,
  MetaGraphBridge,
  WebhookRespondReconcileService,
  WebhookRespondReconcileWorker,
  WebhookRespondService,
  WebhookRespondWorker,
  type InteractionResponseConfig,
  type TemplateMap,
  type WebhookRespondJobData,
  type WebhookRespondReconcileJobData,
} from './interaction-response/index.js';
import {
  ContentPublishService,
  ContentPublishWorker,
  PublicationReconcileService,
  PublicationReconcileWorker,
  type ContentPublishJobData,
  type PublicationReconcileJobData,
} from './publication/index.js';

const DEFAULT_INTERACTION_RESPONSE_CONFIG: InteractionResponseConfig = {
  rules: [],
  maxResponsesPerHour: 20,
  minIntervalSeconds: 30,
};

const DEFAULT_TEMPLATES: TemplateMap = {};

async function main(): Promise<void> {
  const config = loadWorkerConfig();

  const db = createDatabaseClient({
    url: config.databaseUrl,
    applicationName: 'content-platform-worker',
  });
  const txManager = new TransactionManager(db.db);

  const queue = new BullMqJobQueue({ redisUrl: config.redisUrl });

  // ---- shared repositories ----

  const outboxRepo = new OutboxRepository(db.db);
  const eventsRepo = new WebhookEventsRepository(db.db);
  const deliveriesRepo = new WebhookDeliveriesRepository(db.db);
  const interactionsRepo = new ExternalInteractionsRepository(db.db);
  const publicationsRepo = new PublicationsRepository(db.db);
  const publicationAttemptsRepo = new PublicationAttemptsRepository(db.db);
  const publicationReconciliationsRepo = new PublicationReconciliationsRepository(db.db);
  const destinationsRepo = new DestinationsRepository(db.db);
  const responsesRepo = new InteractionResponsesRepository(db.db);
  const attemptsRepo = new InteractionResponseAttemptsRepository(db.db);
  const reconciliationsRepo = new InteractionResponseReconciliationsRepository(db.db);

  // ---- outbox dispatcher ----

  const dispatcher = new OutboxDispatcher({ outboxRepo, queue, config });

  // ---- interaction response service (policy + template + outbox enqueue) ----

  const interactionResponseService = new InteractionResponseService({
    txManager,
    responsesRepo,
    outboxRepo,
  });

  // ---- webhook.process wiring ----

  const extractorRegistry = new ChangeExtractorRegistry()
    .register(new FeedChangeExtractor())
    .register(new MentionChangeExtractor());

  const webhookProcessService = new WebhookProcessService({
    txManager,
    eventsRepo,
    deliveriesRepo,
    interactionsRepo,
    publicationsRepo,
    destinationsRepo,
    responsesRepo,
    extractorRegistry,
    interactionResponseService,
    interactionResponseConfig: DEFAULT_INTERACTION_RESPONSE_CONFIG,
    templates: DEFAULT_TEMPLATES,
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

  // ---- Meta Graph bridge + adapters ----

  const metaGraphBridge = new MetaGraphBridge({
    apiVersion: config.metaGraphApiVersion,
  });

  const getAccessToken = async (_destinationId: string): Promise<string> => {
    if (!config.metaPageAccessToken) {
      throw new Error('META_PAGE_ACCESS_TOKEN is not set');
    }
    return config.metaPageAccessToken;
  };

  const metaAdapter = new MetaInteractionAdapter(
    {
      graphClient: metaGraphBridge,
      rateLimiter: new NoopMetaRateLimiter(),
      getAccessToken,
    },
    { apiVersion: config.metaGraphApiVersion },
  );

  const metaPublisherAdapter = new MetaPublisherAdapter(
    {
      graphClient: metaGraphBridge,
      rateLimiter: new NoopMetaRateLimiter(),
      getAccessToken,
    },
    { apiVersion: config.metaGraphApiVersion },
  );

  const metaResponseReconciler = new MetaResponseReconciler({
    graphGetClient: metaGraphBridge,
    getAccessToken,
  });

  const metaPublicationReconciler = new MetaPublicationReconciler({
    graphGetClient: metaGraphBridge,
    getAccessToken,
  });

  // ---- webhook.respond + reconcile wiring ----

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

  const webhookRespondReconcileService = new WebhookRespondReconcileService({
    txManager,
    responsesRepo,
    reconciliationsRepo,
    interactionsRepo,
    outboxRepo,
    reconciler: metaResponseReconciler,
  });

  const webhookRespondReconcileWorker = new WebhookRespondReconcileWorker({
    consumerFactory: (options) =>
      new BullMqJobConsumer<WebhookRespondReconcileJobData>({
        redisUrl: config.redisUrl,
        queueName: options.queueName,
        processor: options.processor,
        onFailed: (jobId, err) => {
          console.error(
            `[webhook.respond.reconcile] job ${jobId ?? '<unknown>'} failed: ${err.message}`,
          );
        },
        onError: (err) => {
          console.error(`[webhook.respond.reconcile] consumer error: ${err.message}`);
        },
      }),
    service: webhookRespondReconcileService,
  });

  // ---- content.publish wiring ----

  const contentPublishService = new ContentPublishService({
    db: db.db,
    txManager,
    publicationsRepo,
    attemptsRepo: publicationAttemptsRepo,
    publisherAdapter: metaPublisherAdapter,
  });

  const contentPublishWorker = new ContentPublishWorker({
    consumerFactory: (options) =>
      new BullMqJobConsumer<ContentPublishJobData>({
        redisUrl: config.redisUrl,
        queueName: options.queueName,
        processor: options.processor,
        onFailed: (jobId, err) => {
          console.error(`[content.publish] job ${jobId ?? '<unknown>'} failed: ${err.message}`);
        },
        onError: (err) => {
          console.error(`[content.publish] consumer error: ${err.message}`);
        },
      }),
    service: contentPublishService,
  });

  // ---- publication.reconcile wiring ----

  const publicationReconcileService = new PublicationReconcileService({
    db: db.db,
    txManager,
    publicationsRepo,
    attemptsRepo: publicationAttemptsRepo,
    reconciliationsRepo: publicationReconciliationsRepo,
    reconciler: metaPublicationReconciler,
  });

  const publicationReconcileWorker = new PublicationReconcileWorker({
    consumerFactory: (options) =>
      new BullMqJobConsumer<PublicationReconcileJobData>({
        redisUrl: config.redisUrl,
        queueName: options.queueName,
        processor: options.processor,
        onFailed: (jobId, err) => {
          console.error(
            `[publication.reconcile] job ${jobId ?? '<unknown>'} failed: ${err.message}`,
          );
        },
        onError: (err) => {
          console.error(`[publication.reconcile] consumer error: ${err.message}`);
        },
      }),
    service: publicationReconcileService,
  });

  // ---- shutdown ----

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`[worker] received ${signal}, shutting down`);
    await publicationReconcileWorker.close();
    await contentPublishWorker.close();
    await webhookRespondReconcileWorker.close();
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
      '[worker] META_PAGE_ACCESS_TOKEN is not set — webhook.respond, content.publish, and publication.reconcile will fail with AUTHENTICATION_ERROR',
    );
  }

  console.info('[worker] started');
  await dispatcher.start();
}

main().catch((err) => {
  console.error('[worker] fatal error:', err);
  process.exit(1);
});
