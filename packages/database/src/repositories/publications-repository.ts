import { and, eq } from 'drizzle-orm';
import { publications } from '../schema/publication/publications.js';
import type { Database } from '../transaction/transaction-manager.js';

type PublicationRow = typeof publications.$inferSelect;

/**
 * Repository for publications.
 *
 * Phase 17 only adds the read-only lookups needed by the webhook
 * processing pipeline. The write side of the publication lifecycle
 * arrives with the publisher adapter phase.
 */
export class PublicationsRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<PublicationRow | undefined> {
    const [row] = await this.db.select().from(publications).where(eq(publications.id, id)).limit(1);
    return row;
  }

  /**
   * Resolve a publication id from the external post identifier.
   *
   * Served by the partial index `publications_external_post_id_idx`
   * (only non-null `external_post_id` values are indexed).
   */
  async findIdByExternalPostId(
    destinationId: string,
    externalPostId: string,
  ): Promise<string | null> {
    const [row] = await this.db
      .select({ id: publications.id })
      .from(publications)
      .where(
        and(
          eq(publications.destinationId, destinationId),
          eq(publications.externalPostId, externalPostId),
        ),
      )
      .limit(1);
    return row?.id ?? null;
  }
}
