import { and, eq } from 'drizzle-orm';
import { destinations } from '../schema/publication/destinations.js';
import type { Database } from '../transaction/transaction-manager.js';

type DestinationRow = typeof destinations.$inferSelect;

export class DestinationsRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<DestinationRow | undefined> {
    const [row] = await this.db.select().from(destinations).where(eq(destinations.id, id)).limit(1);
    return row;
  }

  async findByTypeAndExternalId(
    type: string,
    externalId: string,
  ): Promise<DestinationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(destinations)
      .where(and(eq(destinations.type, type), eq(destinations.externalId, externalId)))
      .limit(1);
    return row;
  }
}
