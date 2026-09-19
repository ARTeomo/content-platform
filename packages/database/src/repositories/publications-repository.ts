import { and, eq, isNotNull, lte, sql } from 'drizzle-orm';
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

/**
 * Repository for publication intent and its state machine.
 *
 * State machine: SCHEDULED → RESERVED → IN_PROGRESS → PUBLISHED
 *                                                  ├→ RETRY
 *                                                  ├→ FAILED
 *                                                  └→ RECONCILIATION
 *
 * Unknown external outcomes are represented by RECONCILIATION and must
 * not automatically become ordinary failures.
 */
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
   * Hot path for webhook processing: resolve a publication from the
   * Meta-side post ID. Served by the partial index
   * publications_external_post_id_idx.
   *
   * Returns `null` when no match is found (not `undefined`), so the
   * result can be used directly as the `resolvePublicationId` return
   * value in the change extractor context.
   *
   * The optional `destinationId` scopes the lookup when the caller has
   * it available. Meta post IDs are globally unique, so the scope is
   * defensive only.
   */
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

  async findStaleInProgress(thresholdSeconds: number, limit: number): Promise<PublicationRow[]> {
    return await this.db
      .select()
      .from(publications)
      .where(
        and(
          eq(publications.status, 'IN_PROGRESS'),
          sql`${publications.updatedAt} < now() - interval '${sql.raw(String(thresholdSeconds))} seconds'`,
        ),
      )
      .orderBy(publications.updatedAt)
      .limit(limit);
  }

  async findReconciliationPending(limit: number): Promise<PublicationRow[]> {
    return await this.db
      .select()
      .from(publications)
      .where(eq(publications.status, 'RECONCILIATION'))
      .orderBy(publications.updatedAt)
      .limit(limit);
  }

  /**
   * Idempotency check: does a publication already exist for this
   * candidate + destination pair with a confirmed external post ID?
   * Used by the scheduler to avoid duplicate enqueues.
   */
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

  async markFailed(tx: Transaction, id: string): Promise<void> {
    await tx
      .update(publications)
      .set({ status: 'FAILED', updatedAt: new Date() })
      .where(eq(publications.id, id));
  }

  async markReconciliation(tx: Transaction, id: string): Promise<void> {
    await tx
      .update(publications)
      .set({ status: 'RECONCILIATION', updatedAt: new Date() })
      .where(eq(publications.id, id));
  }
}
