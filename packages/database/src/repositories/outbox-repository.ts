import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import { outboxJobs } from '../schema/platform/outbox-jobs.js';
import type { Database, Transaction } from '../transaction/transaction-manager.js';

export type OutboxJobStatus = 'PENDING' | 'DISPATCHING' | 'DISPATCHED' | 'FAILED';

export interface OutboxJobInput {
  /** The BullMQ queue name. */
  queueName: string;
  /** Deterministic BullMQ job ID (deduplication key). */
  jobId: string;
  /** Job payload. Identifiers only — never a full document. */
  payload: Record<string, unknown>;
  /** Optional trace ID for cross-system correlation. */
  traceId?: string;
}

export interface OutboxJob {
  id: string;
  queueName: string;
  jobId: string;
  payload: Record<string, unknown>;
  status: OutboxJobStatus;
  attempts: number;
  lastAttemptAt: Date | null;
  lastError: string | null;
  dispatchedAt: Date | null;
  traceId: string | null;
  createdAt: Date;
}

/**
 * Repository for the transactional outbox.
 *
 * `enqueue` is idempotent on `job_id`: a duplicate job with the same
 * deterministic id is silently ignored and the method returns false.
 * This makes the outbox safe to rebuild from durable state — the
 * `system.rebuild` service can re-issue jobs without worrying about
 * collisions with rows that already exist.
 */
export class OutboxRepository {
  constructor(private readonly db: Database) {}

  /**
   * Enqueue a job inside a caller-controlled transaction.
   *
   * Returns true if the row was inserted, false if a row with the same
   * `job_id` already existed.
   */
  async enqueue(tx: Transaction, job: OutboxJobInput): Promise<boolean> {
    const inserted = await tx
      .insert(outboxJobs)
      .values({
        queueName: job.queueName,
        jobId: job.jobId,
        payload: job.payload,
        ...(job.traceId !== undefined && { traceId: job.traceId }),
      })
      .onConflictDoNothing({ target: outboxJobs.jobId })
      .returning({ id: outboxJobs.id });

    return inserted.length === 1;
  }

  async claimPendingBatch(limit: number): Promise<OutboxJob[]> {
    const claimed = (await this.db.execute(sql`
      WITH claimed AS (
        SELECT id FROM outbox_jobs
        WHERE status = 'PENDING'
        ORDER BY created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE outbox_jobs
      SET status = 'DISPATCHING',
          last_attempt_at = now(),
          attempts = attempts + 1
      WHERE id IN (SELECT id FROM claimed)
      RETURNING id
    `)) as unknown as Array<{ id: string }>;

    if (claimed.length === 0) return [];

    const ids = claimed.map((c) => c.id);

    const rows = await this.db
      .select()
      .from(outboxJobs)
      .where(inArray(outboxJobs.id, ids))
      .orderBy(asc(outboxJobs.createdAt));

    return rows.map((row) => ({
      id: row.id,
      queueName: row.queueName,
      jobId: row.jobId,
      payload: row.payload as Record<string, unknown>,
      status: row.status as OutboxJobStatus,
      attempts: row.attempts,
      lastAttemptAt: row.lastAttemptAt,
      lastError: row.lastError,
      dispatchedAt: row.dispatchedAt,
      traceId: row.traceId,
      createdAt: row.createdAt,
    }));
  }

  async markDispatched(id: string): Promise<void> {
    await this.db
      .update(outboxJobs)
      .set({
        status: 'DISPATCHED',
        dispatchedAt: new Date(),
        lastError: null,
      })
      .where(eq(outboxJobs.id, id));
  }

  async markDispatchFailed(id: string, error: string, maxAttempts: number): Promise<void> {
    await this.db
      .update(outboxJobs)
      .set({
        status: sql`CASE WHEN ${outboxJobs.attempts} >= ${maxAttempts} THEN 'FAILED' ELSE 'PENDING' END`,
        lastError: error,
      })
      .where(eq(outboxJobs.id, id));
  }

  async recoverStale(thresholdSeconds: number): Promise<number> {
    const rows = await this.db
      .update(outboxJobs)
      .set({ status: 'PENDING' })
      .where(
        and(
          eq(outboxJobs.status, 'DISPATCHING'),
          lt(
            outboxJobs.lastAttemptAt,
            sql`now() - interval '${sql.raw(String(thresholdSeconds))} seconds'`,
          ),
        ),
      )
      .returning({ id: outboxJobs.id });

    return rows.length;
  }

  /**
   * Delete DISPATCHED rows older than `days`.
   *
   * Called by the dedicated `system.outbox.cleanup` worker, not by the
   * dispatcher itself.
   */
  async cleanupOlderThan(days: number): Promise<number> {
    const rows = await this.db
      .delete(outboxJobs)
      .where(
        and(
          eq(outboxJobs.status, 'DISPATCHED'),
          lt(outboxJobs.dispatchedAt, sql`now() - interval '${sql.raw(String(days))} days'`),
        ),
      )
      .returning({ id: outboxJobs.id });

    return rows.length;
  }
}
