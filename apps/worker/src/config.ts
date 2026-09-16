/**
 * Runtime configuration for the worker process.
 *
 * Values are read from the process environment. The worker does not read
 * `.env` files directly — the caller (systemd, Docker, or a local shell)
 * is responsible for loading them.
 */

export interface WorkerConfig {
  /** PostgreSQL connection URL. */
  databaseUrl: string;
  /** Upstash Redis connection URL (`rediss://...`). */
  redisUrl: string;
  /** BullMQ queue prefix. Default: `content-platform`. */
  queuePrefix: string;
  /** Outbox dispatcher batch size. Default: 100. */
  outboxDispatchBatchSize: number;
  /** Outbox dispatcher idle backoff in ms. Default: 2000. */
  outboxDispatchIdleBackoffMs: number;
  /** Max dispatch attempts before a row becomes FAILED. Default: 10. */
  outboxDispatchMaxAttempts: number;
  /** Stale DISPATCHING threshold in seconds. Default: 60. */
  outboxDispatchStaleThresholdSeconds: number;
  /** Outbox recovery interval in seconds. Default: 30. */
  outboxRecoveryIntervalSeconds: number;
  /** Outbox cleanup retention in days. Default: 7. */
  outboxCleanupRetentionDays: number;
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
  };
}
