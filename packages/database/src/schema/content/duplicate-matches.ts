import { sql } from 'drizzle-orm';
import { check, index, pgTable, real, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn } from '../_common.js';
import { contentItems } from './content-items.js';

/**
 * Evidence that two distinct ContentItems represent duplicate or
 * substantially equivalent content.
 *
 * The relationship preserves duplicate-detection evidence separately
 * from the canonical identity resolution decision. A fingerprint match
 * is not itself a canonicalization.
 *
 * ## Reciprocal uniqueness
 *
 * Pair symmetry (the same two items must not appear as both A→B and
 * B→A under the same detection method) cannot be expressed with a simple
 * unique constraint. Per ADR-004 (no database triggers), this invariant
 * is enforced by the application layer that writes duplicate matches.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.17
 */
export const duplicateMatches = pgTable(
  'duplicate_matches',
  {
    id: idColumn(),
    canonicalItemId: uuid('canonical_item_id')
      .notNull()
      .references(() => contentItems.id, { onDelete: 'cascade' }),
    duplicateItemId: uuid('duplicate_item_id')
      .notNull()
      .references(() => contentItems.id, { onDelete: 'cascade' }),
    similarityScore: real('similarity_score').notNull(),
    detectionMethod: varchar('detection_method', { length: 64 }).notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('duplicate_matches_canonical_duplicate_method_uq').on(
      table.canonicalItemId,
      table.duplicateItemId,
      table.detectionMethod,
    ),
    index('duplicate_matches_canonical_idx').on(table.canonicalItemId),
    index('duplicate_matches_duplicate_idx').on(table.duplicateItemId),
    check(
      'duplicate_matches_similarity_check',
      sql`${table.similarityScore} >= 0 AND ${table.similarityScore} <= 1`,
    ),
    check(
      'duplicate_matches_distinct_check',
      sql`${table.canonicalItemId} <> ${table.duplicateItemId}`,
    ),
  ],
);
