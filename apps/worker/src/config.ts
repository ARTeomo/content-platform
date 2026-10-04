/**
 * Runtime configuration for the worker process.
 *
 * Values are read from the process environment. The worker does not read
 * `.env` files directly — the caller (systemd, Docker, or a local shell)
 * is responsible for loading them.
 */

export interface WorkerConfig {
  databaseUrl: string;
  redisUrl: string;
  queuePrefix: string;

  // Outbox dispatcher
  outboxDispatchBatchSize: number;
  outboxDispatchIdleBackoffMs: number;
  outboxDispatchMaxAttempts: number;
  outboxDispatchStaleThresholdSeconds: number;
  outboxRecoveryIntervalSeconds: number;
  outboxCleanupRetentionDays: number;

  // System.outbox.cleanup scheduler
  /**
   * Polling interval for the `system.outbox.cleanup` scheduler, ms.
   * Zero disables the scheduler; cleanup must then be triggered
   * manually by publishing to the queue.
   */
  systemOutboxCleanupIntervalMs: number;

  // Publication scheduler
  publicationScheduleIntervalMs: number;
  publicationScheduleBatchSize: number;
  publicationReconcileStaleThresholdSeconds: number;

  // Interaction response scheduler
  interactionResponseScheduleIntervalMs: number;
  interactionResponseScheduleBatchSize: number;
  interactionResponseStaleThresholdSeconds: number;

  // System rebuild
  /** Default staleness threshold for the rebuild scan, seconds. */
  systemRebuildStaleThresholdSeconds: number;
  /** Default batch size for the rebuild scan. */
  systemRebuildBatchSize: number;

  // Meta Graph API
  metaGraphApiVersion: string;
  metaAppId: string | undefined;
  metaAppSecret: string | undefined;
  metaCredentialEncryptionKeys: Record<string, string> | undefined;
  metaCredentialEncryptionActiveVersion: number | undefined;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

function optionalInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got "${raw}"`);
  }
  return parsed;
}

function parseCredentialKeys(raw: string | undefined): Record<string, string> | undefined {
  if (!raw || raw.length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('must be a JSON object');
    }
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== 'string') {
        throw new Error(`value for key "${k}" must be a base64 string`);
      }
      result[k] = v;
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`META_CREDENTIAL_ENCRYPTION_KEYS is not valid JSON: ${msg}`);
  }
}

export function loadWorkerConfig(): WorkerConfig {
  return {
    databaseUrl: requireEnv('DATABASE_URL'),
    redisUrl: requireEnv('REDIS_URL'),
    queuePrefix: process.env.QUEUE_PREFIX ?? 'content-platform',

    outboxDispatchBatchSize: optionalInt('OUTBOX_DISPATCH_BATCH_SIZE', 100),
    outboxDispatchIdleBackoffMs: optionalInt('OUTBOX_DISPATCH_IDLE_BACKOFF_MS', 2000),
    outboxDispatchMaxAttempts: optionalInt('OUTBOX_DISPATCH_MAX_ATTEMPTS', 10),
    outboxDispatchStaleThresholdSeconds: optionalInt('OUTBOX_DISPATCH_STALE_THRESHOLD_SECONDS', 60),
    outboxRecoveryIntervalSeconds: optionalInt('OUTBOX_RECOVERY_INTERVAL_SECONDS', 30),
    outboxCleanupRetentionDays: optionalInt('OUTBOX_CLEANUP_RETENTION_DAYS', 7),

    systemOutboxCleanupIntervalMs: optionalInt('SYSTEM_OUTBOX_CLEANUP_INTERVAL_MS', 60 * 60 * 1000),

    publicationScheduleIntervalMs: optionalInt('PUBLICATION_SCHEDULE_INTERVAL_MS', 30000),
    publicationScheduleBatchSize: optionalInt('PUBLICATION_SCHEDULE_BATCH_SIZE', 50),
    publicationReconcileStaleThresholdSeconds: optionalInt(
      'PUBLICATION_RECONCILE_STALE_THRESHOLD_SECONDS',
      300,
    ),

    interactionResponseScheduleIntervalMs: optionalInt(
      'INTERACTION_RESPONSE_SCHEDULE_INTERVAL_MS',
      30000,
    ),
    interactionResponseScheduleBatchSize: optionalInt(
      'INTERACTION_RESPONSE_SCHEDULE_BATCH_SIZE',
      50,
    ),
    interactionResponseStaleThresholdSeconds: optionalInt(
      'INTERACTION_RESPONSE_STALE_THRESHOLD_SECONDS',
      300,
    ),

    systemRebuildStaleThresholdSeconds: optionalInt('SYSTEM_REBUILD_STALE_THRESHOLD_SECONDS', 300),
    systemRebuildBatchSize: optionalInt('SYSTEM_REBUILD_BATCH_SIZE', 100),

    metaGraphApiVersion: process.env.META_GRAPH_API_VERSION ?? 'v21.0',
    metaAppId: process.env.META_APP_ID,
    metaAppSecret: process.env.META_APP_SECRET,

    metaCredentialEncryptionKeys: parseCredentialKeys(process.env.META_CREDENTIAL_ENCRYPTION_KEYS),
    metaCredentialEncryptionActiveVersion: process.env.META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION
      ? Number.parseInt(process.env.META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION, 10)
      : undefined,
  };
}
