import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, nullableTimestampColumn, updatedAtColumn } from '../_common.js';
import { publicationCandidates } from './publication-candidates.js';
import { destinations } from './destinations.js';

/**
 * Durable publication intent and external publication state.
 *
 * The publication state machine:
 *
 *   SCHEDULED → RESERVED → IN_PROGRESS → PUBLISHED
 *                                       ├→ RETRY
 *                                       ├→ FAILED
 *                                       └→ RECONCILIATION
 *
 * Unknown external outcomes are represented by RECONCILIATION and must
 * not automatically become ordinary failures.
 *
 * ## Unique business identity
 *
 * A final unique constraint on the logical publication identity is
 * deferred until the content-candidate relationship is resolved by the
 * application model (see DATABASE_SCHEMA_CONTRACT.md §5.25). The
 * application-level lock key is `publication:{contentId}:{destinationId}`.
 *
 * ## Hot-path lookup
 *
 * `external_post_id` is the natural lookup key for the webhook
 * processing pipeline (see §8.6). The partial index below serves that
 * hot path without indexing the majority-null rows.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.25, §8.6
 */
export const publications = pgTable(
  'publications',
  {
    id: idColumn(),
    publicationCandidateId: uuid('publication_candidate_id')
      .notNull()
      .references(() => publicationCandidates.id, { onDelete: 'restrict' }),
    destinationId: uuid('destination_id')
      .notNull()
      .references(() => destinations.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('SCHEDULED'),
    scheduledAt: nullableTimestampColumn('scheduled_at'),
    publishedAt: nullableTimestampColumn('published_at'),
    externalPostId: text('external_post_id'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('publications_status_idx').on(table.status),
    index('publications_scheduled_at_idx').on(table.scheduledAt),
    index('publications_external_post_id_idx')
      .on(table.externalPostId)
      .where(sql`${table.externalPostId} IS NOT NULL`),
    check(
      'publications_status_check',
      sql`${table.status} IN ('SCHEDULED', 'RESERVED', 'IN_PROGRESS', 'PUBLISHED', 'RETRY', 'FAILED', 'RECONCILIATION')`,
    ),
  ],
);
