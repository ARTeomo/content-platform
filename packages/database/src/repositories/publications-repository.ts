import { and, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { publications } from '../schema/publication/publications.js';
import type { Database, Transaction } from '../transaction/transaction-manager.js';

type PublicationRow = typeof publications.$inferSelect;

export type PublicationStatus =
  'SCHEDULED' | 'RESERVED' | 'IN_PROGRESS' | 'PUBLISHED' | 'RETRY' | 'FAILED' | 'RECONCILIATION';

export interface PublicationCreateInput {
  publicationCandidateId: string;
  destinationId: string;
  scheduledAt?: Date;
}

export class PublicationsRepository {
  constructor(private readonly db: Database) {}

  async create(tx: Transaction, input: PublicationCreateInput): Promise<PublicationRow> {
    const [row] = await tx
      .insert(publications)
      .values({
        publicationCandidateId: input.publicationCandidateId,
        destinationId: input.destinationId,
        status: 'SCHEDULED',
        ...(input.scheduledAt !== undefined && { scheduledAt: input.scheduledAt }),
      })
      .returning();
    if (!row) throw new Error('Failed to insert publication');
    return row;
  }

  async findById(id: string): Promise<PublicationRow | undefined> {
    const [row] = await this.db.select().from(publications).where(eq(publications.id, id)).limit(1);
    return row;
  }

  /**
   * Batch lookup: for a set of publication IDs, return a map of
   * id -> destinationId. Used by the scheduler to perform a single
   * credential health check per destination instead of per publication.
   */
  async findDestinationIdsByIds(
    tx: Transaction,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (ids.length === 0) return result;

    const rows = await tx
      .select({ id: publications.id, destinationId: publications.destinationId })
      .from(publications)
      .where(inArray(publications.id, [...ids]));

    for (const row of rows) {
      result.set(row.id, row.destinationId);
    }
    return result;
  }

  async findIdByExternalPostId(
    externalPostId: string,
    destinationId?: string,
  ): Promise<string | null> {
    const whereClause =
      destinationId !== undefined
        ? and(
            eq(publications.externalPostId, externalPostId),
            eq(publications.destinationId, destinationId),
          )
        : eq(publications.externalPostId, externalPostId);

    const [row] = await this.db
      .select({ id: publications.id })
      .from(publications)
      .where(whereClause)
      .limit(1);
    return row?.id ?? null;
  }

  async findByExternalPostId(externalPostId: string): Promise<PublicationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(publications)
      .where(eq(publications.externalPostId, externalPostId))
      .limit(1);
    return row;
  }

  async findScheduledDue(now: Date, limit: number): Promise<PublicationRow[]> {
    return await this.db
      .select()
      .from(publications)
      .where(and(eq(publications.status, 'SCHEDULED'), lte(publications.scheduledAt, now)))
      .orderBy(publications.scheduledAt)
      .limit(limit);
  }

  /**
   * Phase 1 of stale-publication recovery (C-D5): candidate selection.
   *
   * Plain read of candidate IDs only — no locks are held and no row is
   * modified here. Eligibility MUST be re-evaluated atomically at claim
   * time (`claimStaleInProgress`), so this scan may return IDs that a
   * concurrent worker has already finalized; claimers must skip those.
   */
  async findStaleInProgress(thresholdSeconds: number, limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: publications.id })
      .from(publications)
      .where(
        and(
          eq(publications.status, 'IN_PROGRESS'),
          sql`${publications.updatedAt} < now() - interval '${sql.raw(String(thresholdSeconds))} seconds'`,
        ),
      )
      .orderBy(publications.updatedAt)
      .limit(limit);
    return rows.map((r) => r.id);
  }

  /**
   * Phase 2 of stale-publication recovery (C-D5): atomic claim.
   *
   * Single conditional UPDATE ... RETURNING. The transition to FAILED is
   * the claim: the status and staleness predicates are re-evaluated at
   * claim time, so exactly one concurrent claimer wins and the winner is
   * the only writer allowed to perform recovery bookkeeping. A crashed
   * worker leaves the external outcome uncertain — FAILED + CRASH_RECOVERY
   * is the safe terminal state; recovery never retries automatically.
   */
  async claimStaleInProgress(
    tx: Transaction,
    id: string,
    thresholdSeconds: number,
  ): Promise<boolean> {
    const rows = (await tx.execute(sql`
      UPDATE publications
      SET status = 'FAILED',
          failure_category = 'CRASH_RECOVERY',
          updated_at = now()
      WHERE id = ${id}
        AND status = 'IN_PROGRESS'
        AND updated_at < now() - interval '${sql.raw(String(thresholdSeconds))} seconds'
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    return rows.length === 1;
  }

  async findReconciliationPending(limit: number): Promise<PublicationRow[]> {
    return await this.db
      .select()
      .from(publications)
      .where(eq(publications.status, 'RECONCILIATION'))
      .orderBy(publications.updatedAt)
      .limit(limit);
  }

  async existsByCandidateAndDestination(
    publicationCandidateId: string,
    destinationId: string,
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ id: publications.id })
      .from(publications)
      .where(
        and(
          eq(publications.publicationCandidateId, publicationCandidateId),
          eq(publications.destinationId, destinationId),
          isNotNull(publications.externalPostId),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /**
   * Atomically claim a publication for outbound execution.
   *
   * Single UPDATE ... RETURNING guarded by the status predicate.
   * Exactly one claimer wins; concurrent claimers get `false` and must
   * exit without touching the external API.
   */
  async claimForPublishing(tx: Transaction, id: string): Promise<boolean> {
    const rows = (await tx.execute(sql`
      UPDATE publications
      SET status = 'IN_PROGRESS',
          updated_at = now()
      WHERE id = ${id}
        AND status IN ('SCHEDULED', 'RESERVED', 'RETRY')
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    return rows.length === 1;
  }

  async markReserved(tx: Transaction, id: string): Promise<void> {
    await tx
      .update(publications)
      .set({ status: 'RESERVED', updatedAt: new Date() })
      .where(eq(publications.id, id));
  }

  async markInProgress(tx: Transaction, id: string): Promise<void> {
    await tx
      .update(publications)
      .set({ status: 'IN_PROGRESS', updatedAt: new Date() })
      .where(eq(publications.id, id));
  }

  async markPublished(
    tx: Transaction,
    id: string,
    externalPostId: string,
    publishedAt: Date,
  ): Promise<void> {
    await tx
      .update(publications)
      .set({
        status: 'PUBLISHED',
        externalPostId,
        publishedAt,
        updatedAt: new Date(),
      })
      .where(eq(publications.id, id));
  }

  async markRetry(tx: Transaction, id: string): Promise<void> {
    await tx
      .update(publications)
      .set({ status: 'RETRY', updatedAt: new Date() })
      .where(eq(publications.id, id));
  }

  async markFailed(tx: Transaction, id: string, failureCategory?: string): Promise<void> {
    await tx
      .update(publications)
      .set({
        status: 'FAILED',
        updatedAt: new Date(),
        ...(failureCategory !== undefined && { failureCategory }),
      })
      .where(eq(publications.id, id));
  }

  async markReconciliation(tx: Transaction, id: string): Promise<void> {
    await tx
      .update(publications)
      .set({ status: 'RECONCILIATION', updatedAt: new Date() })
      .where(eq(publications.id, id));
  }

  /**
   * Atomic success claim (C-D5 race fix).
   *
   * Transitions the publication to PUBLISHED only from states the success
   * path may own: its own execution state (IN_PROGRESS), or a row already
   * claimed by crash recovery (FAILED + CRASH_RECOVERY) — in the latter
   * case the confirmed external post is recorded rather than discarded
   * and the superseded recovery category is cleared. Real failures (FAILED
   * without the recovery category), credential-gate failures,
   * RECONCILIATION rows, and already-PUBLISHED rows are refused: a late
   * success must never blindly overwrite another lifecycle path's state.
   * Exactly one concurrent writer wins the RETURNING row.
   */
  async claimPublished(
    tx: Transaction,
    id: string,
    externalPostId: string,
    publishedAt: Date,
  ): Promise<boolean> {
    const rows = (await tx.execute(sql`
      UPDATE publications
      SET status = 'PUBLISHED',
          external_post_id = ${externalPostId},
          published_at = ${publishedAt.toISOString()}::timestamptz,
          failure_category = NULL,
          updated_at = now()
      WHERE id = ${id}
        AND (status = 'IN_PROGRESS' OR (status = 'FAILED' AND failure_category = 'CRASH_RECOVERY'))
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    return rows.length === 1;
  }

  /**
   * Phase 1 of retry requeue (C-D6): plain-read candidates.
   *
   * `RETRY` publications ordered by `updated_at` (the backoff clock
   * starts at the RETRY transition), each with its max attempt number
   * (0 for anomalous attempt-less rows). No locks; eligibility is
   * re-evaluated atomically at claim time.
   */
  async findRetryCandidates(limit: number): Promise<
    Array<{
      id: string;
      updatedAt: Date;
      maxAttempt: number;
    }>
  > {
    const rows = await this.db.execute(sql`
      SELECT p.id, p.updated_at,
             COALESCE(MAX(pa.attempt_number), 0)::int AS max_attempt
      FROM publications p
      LEFT JOIN publication_attempts pa ON pa.publication_id = p.id
      WHERE p.status = 'RETRY'
      GROUP BY p.id, p.updated_at
      ORDER BY p.updated_at ASC
      LIMIT ${limit}
    `);
    return (rows as unknown as Array<{ id: string; updated_at: Date; max_attempt: number }>).map(
      (r) => ({ id: r.id, updatedAt: r.updated_at, maxAttempt: r.max_attempt }),
    );
  }

  /**
   * Atomic exhaustion claim (C-D6): flips a `RETRY` row to
   * `FAILED`/`RETRY_EXHAUSTED` only while it is still `RETRY` and its
   * attempt count has reached the bound. The count is re-derived inside
   * the UPDATE, so the claim is authoritative even against concurrent
   * transitions. Exactly one claimer wins.
   */
  async claimRetryExhausted(tx: Transaction, id: string, maxAttempts: number): Promise<boolean> {
    const rows = (await tx.execute(sql`
      UPDATE publications
      SET status = 'FAILED',
          failure_category = 'RETRY_EXHAUSTED',
          updated_at = now()
      WHERE id = ${id}
        AND status = 'RETRY'
        AND (SELECT COALESCE(MAX(attempt_number), 0)
             FROM publication_attempts WHERE publication_id = ${id}) >= ${maxAttempts}
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    return rows.length === 1;
  }

  /**
   * Atomic due-retry claim (C-D6): flips a `RETRY` row back to
   * `SCHEDULED` only while it is still `RETRY`, still under the attempt
   * bound, and past the backoff delay. The attempt count is re-derived
   * inside the UPDATE and the caller passes the delay computed from the
   * same in-transaction read. Scan 1 picks the row up on a later tick
   * (credential gate + attempt-scoped outbox enqueue); no enqueue here.
   */
  async claimRetryDue(
    tx: Transaction,
    id: string,
    maxAttempts: number,
    delaySeconds: number,
  ): Promise<boolean> {
    const rows = (await tx.execute(sql`
      UPDATE publications
      SET status = 'SCHEDULED',
          scheduled_at = now(),
          updated_at = now()
      WHERE id = ${id}
        AND status = 'RETRY'
        AND (SELECT COALESCE(MAX(attempt_number), 0)
             FROM publication_attempts WHERE publication_id = ${id}) < ${maxAttempts}
        AND updated_at <= now() - (${delaySeconds} * interval '1 second')
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    return rows.length === 1;
  }

  /**
   * Requeue publications whose only failure was the scheduler's
   * credential gate, after a credential for the destination has been
   * stored. Idempotent: a second run finds no FAILED+CREDENTIAL_GATE
   * rows for the destination. Returns the requeued publication ids.
   */
  async requeueCredentialGateFailures(tx: Transaction, destinationId: string): Promise<string[]> {
    const rows = (await tx.execute(sql`
      UPDATE publications
      SET status = 'SCHEDULED',
          scheduled_at = now(),
          failure_category = NULL,
          updated_at = now()
      WHERE destination_id = ${destinationId}
        AND status = 'FAILED'
        AND failure_category = 'CREDENTIAL_GATE'
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  async claimDueScheduled(tx: Transaction, limit: number): Promise<string[]> {
    const rows = (await tx.execute(sql`
      WITH claimed AS (
        SELECT id FROM publications
        WHERE status = 'SCHEDULED'
          AND scheduled_at IS NOT NULL
          AND scheduled_at <= now()
        ORDER BY scheduled_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE publications
      SET status = 'RESERVED',
          updated_at = now()
      WHERE id IN (SELECT id FROM claimed)
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  async touchStaleReconciliation(
    tx: Transaction,
    thresholdSeconds: number,
    limit: number,
  ): Promise<string[]> {
    const rows = (await tx.execute(sql`
      WITH claimed AS (
        SELECT id FROM publications
        WHERE status = 'RECONCILIATION'
          AND updated_at < now() - interval '${sql.raw(String(thresholdSeconds))} seconds'
        ORDER BY updated_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE publications
      SET updated_at = now()
      WHERE id IN (SELECT id FROM claimed)
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }
}
