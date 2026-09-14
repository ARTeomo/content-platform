import { and, eq, lt, sql } from 'drizzle-orm';
import { outboxJobs, type OutboxJobRow } from '../schema/platform/outbox-jobs.js';
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
 * `enqueue` must be called inside a caller-controlled transaction. All
 * other methods operate on the pool directly and are used by the
 * OutboxDispatcher.
 */
export class OutboxRepository {
  constructor(private readonly db: Database) {}

  /**
   * Enqueue a job inside a caller-controlled transaction.
   *
   * This is the only method that participates in a domain transaction.
   * The insert becomes visible only when the outer transaction commits.
   */
  async enqueue(tx: Transaction, job: OutboxJobInput): Promise<void> {
    await tx.insert(outboxJobs).values({
      queueName: job.queueName,
      jobId: job.jobId,
      payload: job.payload,
      ...(job.traceId !== undefined && { traceId: job.traceId }),
    });
  }

  /**
   * Atomically claim up to `limit` PENDING rows and mark them DISPATCHING.
   *
   * Uses FOR UPDATE SKIP LOCKED to allow concurrent dispatcher instances
   * without coordination. If a dispatcher crashes after claiming but
   * before dispatching, `recoverStale` restores the row to PENDING.
   */
  async claimPendingBatch(limit: number): Promise<OutboxJob[]> {
    const rows = (await this.db.execute(sql`
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
      RETURNING *
    `)) as unknown as OutboxJobRow[];

    return rows.map(mapOutboxJobRow);
  }

  /**
   * Mark a claimed row as successfully dispatched to BullMQ.
   */
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

  /**
   * Record a dispatch failure.
   *
   * If attempts >= maxAttempts the row becomes FAILED (terminal). Otherwise
   * it returns to PENDING for the next dispatcher cycle.
   */
  async markDispatchFailed(id: string, error: string, maxAttempts: number): Promise<void> {
    await this.db
      .update(outboxJobs)
      .set({
        status: sql`CASE WHEN ${outboxJobs.attempts} >= ${maxAttempts} THEN 'FAILED' ELSE 'PENDING' END`,
        lastError: error,
      })
      .where(eq(outboxJobs.id, id));
  }

  /**
   * Restore stale DISPATCHING rows to PENDING.
   *
   * A row is stale if it has been in DISPATCHING for longer than
   * `thresholdSeconds`. Returns the number of rows recovered.
   */
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
   * Delete DISPATCHED rows older than `days`. Returns the number of rows deleted.
   *
   * PENDING, DISPATCHING, and FAILED rows are never deleted by cleanup.
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

function mapOutboxJobRow(row: OutboxJobRow): OutboxJob {
  return {
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
  };
}
