import { Queue, type JobsOptions } from 'bullmq';
import { Redis, type RedisOptions } from 'ioredis';
import type { JobQueue } from './job-queue.js';

export interface BullMqJobQueueOptions {
  redisUrl: string;
  prefix?: string;
}

export function redisOptionsFromUrl(redisUrl: string): RedisOptions {
  const parsed = new URL(redisUrl);
  const isUpstashHost = parsed.hostname.endsWith('.upstash.io');
  const envTls = process.env.REDIS_TLS === '1' || process.env.REDIS_TLS === 'true';
  const isTls = parsed.protocol === 'rediss:' || isUpstashHost || envTls;

  const options: RedisOptions = {
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 6379,
    family: 4,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    keepAlive: 30_000,
    connectTimeout: 15_000,
    retryStrategy: (times) => Math.min(times * 200, 3_000),
  };

  if (parsed.username) options.username = decodeURIComponent(parsed.username);
  if (parsed.password) options.password = decodeURIComponent(parsed.password);
  if (isTls) {
    options.tls = { servername: parsed.hostname, minVersion: 'TLSv1.2' };
  }

  return options;
}

/**
 * BullMQ-backed `JobQueue`.
 *
 * ## `removeOnComplete` and the `jobId` dedup contract
 *
 * BullMQ deduplicates by `jobId`: if a job with the same ID already
 * exists in **any** state (waiting, active, delayed, completed, failed),
 * `queue.add()` is a silent no-op. This is by design — it is what makes
 * `jobId` a reliable idempotency key.
 *
 * The consequence is that a completed job blocks re-enqueue with the
 * same `jobId` until the retention policy removes it. With the previous
 * `removeOnComplete: 1000` setting, up to 1000 completed jobs were kept
 * indefinitely, so a recovered outbox row could never be redispatched.
 *
 * `removeOnComplete: true` removes the job immediately on completion.
 * BullMQ is a transient execution layer; the durable history of every
 * external side effect already lives in `publication_attempts`,
 * `webhook_deliveries`, `interaction_response_attempts`, and
 * `interaction_response_reconciliations`. Nothing is lost.
 *
 * `removeOnFail: false` keeps failed jobs for inspection. Failed jobs
 * stay in the queue until manually removed or until a future operational
 * tool purges them. If a failed job blocks re-enqueue, the same class of
 * problem appears — but failed jobs are exceptional and are expected to
 * be investigated, not silently retried with the same `jobId`.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §12.5
 */
export class BullMqJobQueue implements JobQueue {
  private readonly connection: Redis;
  private readonly prefix: string;
  private readonly defaultJobOptions: JobsOptions;
  private readonly queues = new Map<string, Queue>();

  constructor(options: BullMqJobQueueOptions) {
    this.connection = new Redis(redisOptionsFromUrl(options.redisUrl));
    this.connection.on('error', (err) => {
      console.error('[bullmq] redis connection error:', err.message);
    });
    this.prefix = options.prefix ?? 'bull';
    this.defaultJobOptions = {
      removeOnComplete: true,
      removeOnFail: false,
    };
  }

  private getQueue(name: string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection: this.connection,
        prefix: this.prefix,
        defaultJobOptions: this.defaultJobOptions,
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  async add(queueName: string, payload: Record<string, unknown>, jobId: string): Promise<void> {
    await this.getQueue(queueName).add(queueName, payload, { jobId });
  }

  async close(): Promise<void> {
    for (const queue of this.queues.values()) await queue.close();
    this.queues.clear();
    await this.connection.quit();
  }
}
