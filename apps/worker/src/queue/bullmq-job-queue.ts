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
    this.defaultJobOptions = { removeOnComplete: 1000, removeOnFail: false };
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
