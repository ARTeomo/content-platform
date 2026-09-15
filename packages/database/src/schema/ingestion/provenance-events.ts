import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { idColumn } from '../_common.js';
import { sourceEndpoints } from './source-endpoints.js';

/**
 * Immutable cross-cutting lineage log.
 *
 * Records how an artifact or canonical content entity entered or
 * progressed through the pipeline. The target is polymorphic — a single
 * provenance mechanism spans DiscoveredResource, RawResource, SourceItem,
 * ContentItem, and ContentVersion.
 *
 * The endpoint reference uses ON DELETE SET NULL so that historical
 * lineage survives intentional endpoint deletion.
 *
 * Provenance events are never updated as part of normal pipeline
 * processing. There is no `updated_at`.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.8
 * @see DB v1 Logical Model Specification §8
 */
export const provenanceEvents = pgTable(
  'provenance_events',
  {
    id: idColumn(),
    targetEntityType: varchar('target_entity_type', { length: 64 }).notNull(),
    targetEntityId: uuid('target_entity_id').notNull(),
    endpointId: uuid('endpoint_id').references(() => sourceEndpoints.id, {
      onDelete: 'set null',
    }),
    phase: varchar('phase', { length: 32 }).notNull(),
    method: varchar('method', { length: 64 }).notNull(),
    artifactHash: varchar('artifact_hash', { length: 128 }),
    observedAt: timestamp('observed_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('provenance_events_target_idx').on(table.targetEntityType, table.targetEntityId),
    index('provenance_events_endpoint_observed_at_idx').on(table.endpointId, table.observedAt),
    check(
      'provenance_events_phase_check',
      sql`${table.phase} IN ('DISCOVERY', 'ACQUISITION', 'EXTRACTION')`,
    ),
    check(
      'provenance_events_target_type_check',
      sql`${table.targetEntityType} IN ('DISCOVERED_RESOURCE', 'RAW_RESOURCE', 'SOURCE_ITEM', 'CONTENT_ITEM', 'CONTENT_VERSION')`,
    ),
  ],
);
