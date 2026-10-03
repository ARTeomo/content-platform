import { desc, eq } from 'drizzle-orm';
import { systemLogs } from '../schema/observability/system-logs.js';
import type { Database, Transaction } from '../transaction/transaction-manager.js';

type SystemLogRow = typeof systemLogs.$inferSelect;

export interface SystemLogInput {
  level: string;
  event: string;
  message?: string;
  traceId?: string;
  contentId?: string;
  storyId?: string;
  sourceId?: string;
  jobId?: string;
  publicationId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Repository for durable, structured operational logs.
 *
 * Only high-value events belong here: state transitions of durable
 * business entities (publication published, credential invalidated),
 * not transient worker activity. Worker tracing remains on stdout.
 */
export class SystemLogsRepository {
  constructor(private readonly db: Database) {}

  async create(tx: Transaction, input: SystemLogInput): Promise<SystemLogRow> {
    const [row] = await tx
      .insert(systemLogs)
      .values({
        level: input.level,
        event: input.event,
        ...(input.message !== undefined && { message: input.message }),
        ...(input.traceId !== undefined && { traceId: input.traceId }),
        ...(input.contentId !== undefined && { contentId: input.contentId }),
        ...(input.storyId !== undefined && { storyId: input.storyId }),
        ...(input.sourceId !== undefined && { sourceId: input.sourceId }),
        ...(input.jobId !== undefined && { jobId: input.jobId }),
        ...(input.publicationId !== undefined && { publicationId: input.publicationId }),
        ...(input.metadata !== undefined && { metadata: input.metadata }),
      })
      .returning();
    if (!row) throw new Error('Failed to insert system log');
    return row;
  }

  async findByTraceId(traceId: string): Promise<SystemLogRow[]> {
    return await this.db
      .select()
      .from(systemLogs)
      .where(eq(systemLogs.traceId, traceId))
      .orderBy(desc(systemLogs.createdAt));
  }
}
