import { desc, eq } from 'drizzle-orm';
import { publicationReconciliations } from '../schema/publication/publication-reconciliations.js';
import type { Database, Transaction } from '../transaction/transaction-manager.js';

type PublicationReconciliationRow = typeof publicationReconciliations.$inferSelect;

export type ReconciliationResult = 'PUBLISHED' | 'RETRY_ELIGIBLE' | 'UNKNOWN';

export interface PublicationReconciliationInput {
  publicationId: string;
  attemptId?: string;
  status: ReconciliationResult;
  checkedAt?: Date;
  externalPostId?: string;
  result?: string;
  details?: Record<string, unknown>;
}

/**
 * Repository for publication reconciliation history.
 *
 * Reconciliation investigates uncertain external publication outcomes
 * (UNKNOWN state). Two paths: push (provider webhook) or pull (query
 * the provider's API).
 */
export class PublicationReconciliationsRepository {
  constructor(private readonly db: Database) {}

  async record(
    tx: Transaction,
    input: PublicationReconciliationInput,
  ): Promise<PublicationReconciliationRow> {
    const [row] = await tx
      .insert(publicationReconciliations)
      .values({
        publicationId: input.publicationId,
        ...(input.attemptId !== undefined && { attemptId: input.attemptId }),
        status: input.status,
        checkedAt: input.checkedAt ?? new Date(),
        ...(input.externalPostId !== undefined && { externalPostId: input.externalPostId }),
        ...(input.result !== undefined && { result: input.result }),
        ...(input.details !== undefined && { details: input.details }),
      })
      .returning();
    if (!row) throw new Error('Failed to record publication reconciliation');
    return row;
  }

  async findByPublicationId(publicationId: string): Promise<PublicationReconciliationRow[]> {
    return await this.db
      .select()
      .from(publicationReconciliations)
      .where(eq(publicationReconciliations.publicationId, publicationId))
      .orderBy(desc(publicationReconciliations.createdAt));
  }

  async findLatestForPublication(
    publicationId: string,
  ): Promise<PublicationReconciliationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(publicationReconciliations)
      .where(eq(publicationReconciliations.publicationId, publicationId))
      .orderBy(desc(publicationReconciliations.createdAt))
      .limit(1);
    return row;
  }
}
