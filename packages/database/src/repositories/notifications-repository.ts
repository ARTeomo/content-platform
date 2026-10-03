import { desc, eq } from 'drizzle-orm';
import { notifications } from '../schema/observability/notifications.js';
import type { Database, Transaction } from '../transaction/transaction-manager.js';

type NotificationRow = typeof notifications.$inferSelect;

export interface NotificationInput {
  type: string;
  severity: string;
  title: string;
  message: string;
  sourceId?: string;
  contentId?: string;
  publicationId?: string;
}

/**
 * Repository for durable operational notifications.
 *
 * Writes are best-effort from the worker's perspective: the caller
 * (see `NotificationService` in the worker) wraps the call in a
 * try/catch so a notification failure cannot mask a business outcome.
 */
export class NotificationsRepository {
  constructor(private readonly db: Database) {}

  async create(tx: Transaction, input: NotificationInput): Promise<NotificationRow> {
    const [row] = await tx
      .insert(notifications)
      .values({
        type: input.type,
        severity: input.severity,
        title: input.title,
        message: input.message,
        ...(input.sourceId !== undefined && { sourceId: input.sourceId }),
        ...(input.contentId !== undefined && { contentId: input.contentId }),
        ...(input.publicationId !== undefined && { publicationId: input.publicationId }),
      })
      .returning();
    if (!row) throw new Error('Failed to insert notification');
    return row;
  }

  async findUnread(limit: number): Promise<NotificationRow[]> {
    return await this.db
      .select()
      .from(notifications)
      .where(eq(notifications.isRead, false))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }
}
