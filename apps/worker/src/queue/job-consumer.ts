import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { redisOptionsFromUrl } from './bullmq-job-queue.js';

export interface JobConsumerJob<T = unknown> {
  id: string;
  name: string;
  data: T;
  attemptsMade: number;
}

export interface JobConsumerOptions<T> {
  /** Upstash Redis URL (`rediss://...`). */
  redisUrl: string;
  /** BullMQ queue name. */
  queueName: string;
  /** Prefix for all BullMQ keys. Default: `bull`. */
  prefix?: string;
  /** Worker concurrency. Default: 5. */
  concurrency?: number;
  /** Process a single job. */
  processor: (job: JobConsumerJob<T>) => Promise<void>;
  /** Called after a job fails. */
  onFailed?: (jobId: string | undefined, err: Error) => void;
  /** Called on connection-level errors. */
  onError?: (err: Error) => void;
}

/**
 * BullMQ `Worker` wrapper.
 *
 * The worker is a thin shell around a `processor` function. It handles
 * the connection, retry semantics, and lifecycle, while the caller
 * provides the actual business logic.
 */
export class BullMqJobConsumer<T = unknown> {
  private readonly worker: Worker;
  private readonly connection: Redis;

  constructor(options: JobConsumerOptions<T>) {
    this.connection = new Redis(redisOptionsFromUrl(options.redisUrl));
    this.connection.on('error', () => {
      /* Suppress noise; onError handles app-level handling. */
    });

    this.worker = new Worker(
      options.queueName,
      async (job: Job) => {
        await options.processor({
          id: job.id ?? '',
          name: job.name,
          data: job.data as T,
          attemptsMade: job.attemptsMade,
        });
      },
      {
        connection: this.connection,
        prefix: options.prefix ?? 'bull',
        concurrency: options.concurrency ?? 5,
      },
    );

    if (options.onFailed) {
      const onFailed = options.onFailed;
      this.worker.on('failed', (job, err) => onFailed(job?.id, err));
    }
    if (options.onError) {
      this.worker.on('error', options.onError);
    }
  }

  async close(): Promise<void> {
    await this.worker.close();
    await this.connection.quit();
  }
}
