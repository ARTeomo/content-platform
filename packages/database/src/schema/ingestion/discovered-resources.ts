import { index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, nullableTimestampColumn, updatedAtColumn } from '../_common.js';

/**
 * Canonical candidate identity created by discovery.
 *
 * A DiscoveredResource represents a candidate resource independently of
 * the observation path that found it. Multiple endpoints discovering the
 * same normalized URL reference the same row.
 *
 * `canonical_url` is the normalized candidate identity and is unique at
 * this layer. Individual detection events are stored separately in
 * `discovery_observations`.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.6
 * @see DB v1 Logical Model Specification §6
 */
export const discoveredResources = pgTable(
  'discovered_resources',
  {
    id: idColumn(),
    canonicalUrl: text('canonical_url').notNull(),
    externalId: text('external_id'),
    publishedAt: nullableTimestampColumn('published_at'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex('discovered_resources_canonical_url_uq').on(table.canonicalUrl),
    index('discovered_resources_published_at_idx').on(table.publishedAt),
  ],
);
