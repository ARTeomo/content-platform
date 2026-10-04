import {
  createDatabaseClient,
  DestinationsRepository,
  ExternalInteractionsRepository,
  InteractionResponseAttemptsRepository,
  InteractionResponseReconciliationsRepository,
  InteractionResponsesRepository,
  NotificationsRepository,
  OutboxRepository,
  PublicationAttemptsRepository,
  PublicationReconciliationsRepository,
  PublicationsRepository,
  SystemConfigRepository,
  SystemLogsRepository,
  TransactionManager,
  WebhookDeliveriesRepository,
  WebhookEventsRepository,
} from '@content-platform/database';
import {
  MetaInteractionAdapter,
  MetaPublicationReconciler,
  MetaPublisherAdapter,
  MetaResponseReconciler,
  RedisMetaRateLimiter,
} from '@content-platform/publishers';
import Redis from 'ioredis';
import { loadWorkerConfig } from './config.js';
import {
  buildGetAccessToken,
  buildMetaCredentialService,
  fallbackRuntimeConfig,
  loadRuntimeConfig,
} from './credentials/index.js';
import { AlertingService, NotificationService, SystemLogService } from './observability/index.js';
import { OutboxDispatcher } from './outbox-dispatcher.js';
import { BullMqJobConsumer, BullMqJobQueue, redisOptionsFromUrl } from './queue/index.js';
import {
  SystemOutboxCleanupSchedulerWorker,
  SystemOutboxCleanupService,
  SystemOutboxCleanupWorker,
  SystemRebuildService,
  SystemRebuildWorker,
  type SystemOutboxCleanupJobData,
  type SystemRebuildJobData,
} from './system/index.js';
import {
  ChangeExtractorRegistry,
  FeedChangeExtractor,
  MentionChangeExtractor,
  WebhookProcessService,
  WebhookProcessWorker,
  type WebhookProcessJobData,
} from './webhook/index.js';
import {
  InteractionResponseSchedulerService,
  InteractionResponseSchedulerWorker,
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
  PublicationSchedulerService,
  PublicationSchedulerWorker,
  type ContentPublishJobData,
  type PublicationReconcileJobData,
} from './publication/index.js';

async function main(): Promise<void> {
  const config = loadWorkerConfig();

  const db = createDatabaseClient({
    url: config.databaseUrl,
    applicationName: 'content-platform-worker',
  });
  const txManager = new TransactionManager(db.db);

  const queue = new BullMqJobQueue({ redisUrl: config.redisUrl });

  const rateLimiterRedis = new Redis({
    ...redisOptionsFromUrl(config.redisUrl),
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
  });
  rateLimiterRedis.on('error', (err) => {
    console.error('[rate-limit] redis connection error:', err.message);
  });

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
  const systemConfigRepo = new SystemConfigRepository(db.db);
  const notificationsRepo = new NotificationsRepository(db.db);
  const systemLogsRepo = new SystemLogsRepository(db.db);

  // ---- observability services ----

  const notificationService = new NotificationService({ txManager, notificationsRepo });
  const systemLogService = new SystemLogService({ txManager, systemLogsRepo });
  const alerting = new AlertingService({
    notifications: notificationService,
    logs: systemLogService,
  });

  // ---- runtime configuration from system_config ----

  let interactionResponseConfig: InteractionResponseConfig;
  let templates: TemplateMap;
  let rateLimitConfig;
  try {
    const runtimeConfig = await loadRuntimeConfig(systemConfigRepo);
    interactionResponseConfig = runtimeConfig.interactionResponseConfig;
    templates = runtimeConfig.templates;
    rateLimitConfig = runtimeConfig.rateLimitConfig;
    if (runtimeConfig.defaultedKeys.length > 0) {
      console.warn(
        `[worker] system_config keys defaulted: ${runtimeConfig.defaultedKeys.join(', ')}`,
      );
    }
    console.info(
      `[worker] interaction response: ${interactionResponseConfig.rules.length} rules, ${Object.keys(templates).length} templates`,
    );
    console.info(
      `[worker] rate limits: publish=${rateLimitConfig.publish.perHourPerDestination}/h/dest, engagement=${rateLimitConfig.engagement.perHourPerDestination}/h/dest`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[worker] failed to load system_config: ${msg}; using fail-closed defaults`);
    const fallback = fallbackRuntimeConfig();
    interactionResponseConfig = fallback.interactionResponseConfig;
    templates = fallback.templates;
    rateLimitConfig = fallback.rateLimitConfig;
  }

  // ---- Meta credential bridge ----

  const credentialBundle = buildMetaCredentialService(db.db, config);
  if (!credentialBundle.available) {
    console.warn(
      `[worker] DB-backed Meta credentials unavailable: ${credentialBundle.unavailableReason}. Outbound Meta calls will fail with AUTHENTICATION_ERROR.`,
    );
  } else {
    console.info('[worker] DB-backed Meta credentials available');
  }

  const getAccessToken = buildGetAccessToken({
    bundle: credentialBundle,
    logger: console,
  });

  // ---- rate limiter ----

  const rateLimiter = new RedisMetaRateLimiter({
    redis: rateLimiterRedis,
    config: rateLimitConfig,
  });

  // ---- outbox dispatcher ----

  const dispatcher = new OutboxDispatcher({ outboxRepo, queue, config });

  // ---- interaction response service ----

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
    interactionResponseConfig,
    templates,
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

  const metaAdapter = new MetaInteractionAdapter(
    { graphClient: metaGraphBridge, rateLimiter, getAccessToken },
    { apiVersion: config.metaGraphApiVersion },
  );

  const metaPublisherAdapter = new MetaPublisherAdapter(
    { graphClient: metaGraphBridge, rateLimiter, getAccessToken },
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
    credentialBundle,
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
    alerting,
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
    credentialBundle,
    alerting,
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

  // ---- publication scheduler wiring ----

  const publicationSchedulerService = new PublicationSchedulerService({
    txManager,
    publicationsRepo,
    outboxRepo,
    batchSize: config.publicationScheduleBatchSize,
    reconcileStaleThresholdSeconds: config.publicationReconcileStaleThresholdSeconds,
    alerting,
    ...(credentialBundle.service !== undefined && {
      credentialService: credentialBundle.service,
    }),
  });

  const publicationSchedulerWorker = new PublicationSchedulerWorker({
    scheduler: publicationSchedulerService,
    intervalMs: config.publicationScheduleIntervalMs,
  });

  // ---- interaction response scheduler wiring ----

  const interactionResponseSchedulerService = new InteractionResponseSchedulerService({
    txManager,
    responsesRepo,
    outboxRepo,
    batchSize: config.interactionResponseScheduleBatchSize,
    staleThresholdSeconds: config.interactionResponseStaleThresholdSeconds,
  });

  const interactionResponseSchedulerWorker = new InteractionResponseSchedulerWorker({
    scheduler: interactionResponseSchedulerService,
    intervalMs: config.interactionResponseScheduleIntervalMs,
  });

  // ---- system.rebuild wiring ----

  const systemRebuildService = new SystemRebuildService({
    db: db.db,
    txManager,
    outboxRepo,
    publicationsRepo,
    interactionResponsesRepo: responsesRepo,
    defaultStaleThresholdSeconds: config.systemRebuildStaleThresholdSeconds,
    defaultLimit: config.systemRebuildBatchSize,
  });

  const systemRebuildWorker = new SystemRebuildWorker({
    consumerFactory: (options) =>
      new BullMqJobConsumer<SystemRebuildJobData>({
        redisUrl: config.redisUrl,
        queueName: options.queueName,
        processor: options.processor,
        onFailed: (jobId, err) => {
          console.error(`[system.rebuild] job ${jobId ?? '<unknown>'} failed: ${err.message}`);
        },
        onError: (err) => {
          console.error(`[system.rebuild] consumer error: ${err.message}`);
        },
      }),
    service: systemRebuildService,
  });

  // ---- system.outbox.cleanup wiring ----

  const systemOutboxCleanupService = new SystemOutboxCleanupService({
    outboxRepo,
    defaultRetentionDays: config.outboxCleanupRetentionDays,
  });

  const systemOutboxCleanupWorker = new SystemOutboxCleanupWorker({
    consumerFactory: (options) =>
      new BullMqJobConsumer<SystemOutboxCleanupJobData>({
        redisUrl: config.redisUrl,
        queueName: options.queueName,
        processor: options.processor,
        onFailed: (jobId, err) => {
          console.error(
            `[system.outbox.cleanup] job ${jobId ?? '<unknown>'} failed: ${err.message}`,
          );
        },
        onError: (err) => {
          console.error(`[system.outbox.cleanup] consumer error: ${err.message}`);
        },
      }),
    service: systemOutboxCleanupService,
  });

  const systemOutboxCleanupSchedulerWorker = new SystemOutboxCleanupSchedulerWorker({
    txManager,
    outboxRepo,
    intervalMs: config.systemOutboxCleanupIntervalMs,
  });

  // ---- shutdown ----

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`[worker] received ${signal}, shutting down`);
    await systemOutboxCleanupSchedulerWorker.stop();
    await interactionResponseSchedulerWorker.stop();
    await publicationSchedulerWorker.stop();
    await systemOutboxCleanupWorker.close();
    await systemRebuildWorker.close();
    await publicationReconcileWorker.close();
    await contentPublishWorker.close();
    await webhookRespondReconcileWorker.close();
    await webhookRespondWorker.close();
    await webhookProcessWorker.close();
    await dispatcher.stop();
    await queue.close();
    await rateLimiterRedis.quit();
    await db.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  console.info('[worker] started');
  systemOutboxCleanupSchedulerWorker.start();
  interactionResponseSchedulerWorker.start();
  publicationSchedulerWorker.start();
  await dispatcher.start();
}

main().catch((err) => {
  console.error('[worker] fatal error:', err);
  process.exit(1);
});
