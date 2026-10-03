/**
 * Runtime configuration for the worker process.
 *
 * Values are read from the process environment. The worker does not read
 * `.env` files directly — the caller (systemd, Docker, or a local shell)
 * is responsible for loading them.
 *
 * Dynamic configuration that can change at runtime (interaction
 * response rules, templates, rate-limit budgets) is loaded from the
 * `system_config` table at startup by `RuntimeConfigLoader`. This file
 * only covers the static process environment.
 */

export interface WorkerConfig {
  /** PostgreSQL connection URL. */
  databaseUrl: string;
  /** Upstash Redis connection URL (`rediss://...`). */
  redisUrl: string;
  /** BullMQ queue prefix. Default: `content-platform`. */
  queuePrefix: string;

  // Outbox dispatcher
  outboxDispatchBatchSize: number;
  outboxDispatchIdleBackoffMs: number;
  outboxDispatchMaxAttempts: number;
  outboxDispatchStaleThresholdSeconds: number;
  outboxRecoveryIntervalSeconds: number;
  outboxCleanupRetentionDays: number;

  // Publication scheduler
  publicationScheduleIntervalMs: number;
  publicationScheduleBatchSize: number;
  publicationReconcileStaleThresholdSeconds: number;

  // Interaction response scheduler (new in Sprint A)
  interactionResponseScheduleIntervalMs: number;
  interactionResponseScheduleBatchSize: number;
  interactionResponseStaleThresholdSeconds: number;

  // Meta Graph API
  metaGraphApiVersion: string;
  /** Meta App ID for token rotation. */
  metaAppId: string | undefined;
  /** Meta App Secret for token rotation. */
  metaAppSecret: string | undefined;

  /**
   * Temporary fallback: Page Access Token sourced from the environment.
   *
   * When a destination has no DB-backed PAGE_ACCESS_TOKEN, the
   * credential bridge falls back to this value. Deprecated — will be
   * removed once the DB credential lifecycle is seeded for every
   * destination. Every fallback use is logged at warn level.
   */
  metaPageAccessToken: string | undefined;

  /**
   * Meta credential encryption key set. Required for the worker to
   * decrypt DB-backed Page Access Tokens.
   *
   * Format: JSON object mapping key version -> base64 32-byte key.
   */
  metaCredentialEncryptionKeys: Record<string, string> | undefined;
  /**
   * Active key version for new Meta credential encryptions. Only used
   * by admin tooling; the worker only decrypts.
   */
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

    metaGraphApiVersion: process.env.META_GRAPH_API_VERSION ?? 'v21.0',
    metaAppId: process.env.META_APP_ID,
    metaAppSecret: process.env.META_APP_SECRET,
    metaPageAccessToken: process.env.META_PAGE_ACCESS_TOKEN,

    metaCredentialEncryptionKeys: parseCredentialKeys(process.env.META_CREDENTIAL_ENCRYPTION_KEYS),
    metaCredentialEncryptionActiveVersion: process.env.META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION
      ? Number.parseInt(process.env.META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION, 10)
      : undefined,
  };
}
