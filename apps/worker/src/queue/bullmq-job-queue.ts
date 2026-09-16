import { Queue } from 'bullmq';
import { Redis, type RedisOptions } from 'ioredis';
import type { JobQueue } from './job-queue.js';

export interface BullMqJobQueueOptions {
  /** Upstash Redis URL (`rediss://...` or `redis://...`). */
  redisUrl: string;
  /** BullMQ queue name. Default: `content-platform`. */
  queueName?: string;
  /** Prefix for all BullMQ keys. Default: `bull`. */
  prefix?: string;
}

/**
 * Parse a Redis URL into `RedisOptions`.
 *
 * ioredis 5.x does not expose a `(url: string, options: RedisOptions)`
 * constructor overload, so the URL must be converted to an options
 * object.
 *
 * ## TLS detection
 *
 * TLS is enabled when any of the following holds:
 *   - The scheme is `rediss://`.
 *   - The hostname ends in `.upstash.io` (Upstash always requires TLS,
 *     but its `redis-cli` copy-paste format uses `redis://`).
 *   - The environment variable `REDIS_TLS` is set to `1` or `true`.
 *
 * ## Critical options for Upstash
 *   - `tls.servername` — SNI hostname. Without it, Upstash drops the
 *     connection with ECONNRESET.
 *   - `family: 4` — force IPv4. Windows dual-stack can try IPv6 first,
 *     which Upstash does not accept.
 *   - `tls.minVersion: 'TLSv1.2'` — Upstash requires TLS 1.2+.
 */
export function redisOptionsFromUrl(redisUrl: string): RedisOptions {
  const parsed = new URL(redisUrl);
  const isUpstashHost = parsed.hostname.endsWith('.upstash.io');
  const envTls = process.env.REDIS_TLS === '1' || process.env.REDIS_TLS === 'true';
  const isTls = parsed.protocol === 'rediss:' || isUpstashHost || envTls;

  const options: RedisOptions = {
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 6379,
    family: 4,
    // BullMQ 5.x requirements:
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // Connection resilience:
    keepAlive: 30_000,
    connectTimeout: 15_000,
    retryStrategy: (times) => Math.min(times * 200, 3_000),
  };

  if (parsed.username) {
    options.username = decodeURIComponent(parsed.username);
  }
  if (parsed.password) {
    options.password = decodeURIComponent(parsed.password);
  }
  if (isTls) {
    options.tls = {
      servername: parsed.hostname,
      minVersion: 'TLSv1.2',
    };
  }

  return options;
}

export class BullMqJobQueue implements JobQueue {
  private readonly queue: Queue;
  private readonly connection: Redis;

  constructor(options: BullMqJobQueueOptions) {
    this.connection = new Redis(redisOptionsFromUrl(options.redisUrl));

    this.connection.on('error', (err) => {
      console.error('[bullmq] redis connection error:', err.message);
    });

    this.queue = new Queue(options.queueName ?? 'content-platform', {
      connection: this.connection,
      prefix: options.prefix ?? 'bull',
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: false,
      },
    });
  }

  async add(name: string, payload: Record<string, unknown>, jobId: string): Promise<void> {
    await this.queue.add(name, payload, { jobId });
  }

  async close(): Promise<void> {
    await this.queue.close();
    await this.connection.quit();
  }
}
