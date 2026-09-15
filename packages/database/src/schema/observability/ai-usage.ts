import { sql } from 'drizzle-orm';
import { check, index, integer, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn } from '../_common.js';
import { contentItems } from '../content/content-items.js';

/**
 * Durable accounting of AI processing usage.
 *
 * Each AI request records its provider, model, operation, token counts,
 * and estimated cost. The authoritative currency or accounting unit for
 * `estimated_cost` is an application-level decision (deferred decision
 * D-006); the database persists a numeric value only.
 *
 * The `estimated_cost` column uses numeric(12,6) and is mapped to a
 * JavaScript number. The maximum value is ~999,999.999999. The
 * application layer is responsible for choosing a currency and for
 * aggregating costs against configured budgets.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.30
 */
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: idColumn(),
    contentId: uuid('content_id').references(() => contentItems.id, { onDelete: 'set null' }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    operation: text('operation').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    estimatedCost: numeric('estimated_cost', { precision: 12, scale: 6, mode: 'number' })
      .notNull()
      .default(0),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('ai_usage_content_id_idx').on(table.contentId),
    index('ai_usage_created_at_idx').on(table.createdAt),
    check('ai_usage_input_tokens_check', sql`${table.inputTokens} >= 0`),
    check('ai_usage_output_tokens_check', sql`${table.outputTokens} >= 0`),
    check('ai_usage_estimated_cost_check', sql`${table.estimatedCost} >= 0`),
  ],
);
