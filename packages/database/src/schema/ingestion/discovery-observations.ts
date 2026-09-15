import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { idColumn, nullableTimestampColumn } from '../_common.js';
import { discoveredResources } from './discovered-resources.js';
import { sourceEndpoints } from './source-endpoints.js';

/**
 * Immutable record of a single discovery of a DiscoveredResource through
 * a specific SourceEndpoint.
 *
 * This is the mechanism that preserves multi-path discovery. The same
 * resource discovered by RSS and Sitemap and HTML listing produces three
 * observations and one DiscoveredResource.
 *
 * The Source is derived through the endpoint relationship and is not
 * duplicated here.
 *
 * Observations are immutable detection records. There is no `updated_at`.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.7
 * @see DB v1 Logical Model Specification §7
 */
export const discoveryObservations = pgTable(
  'discovery_observations',
  {
    id: idColumn(),
    discoveredResourceId: uuid('discovered_resource_id')
      .notNull()
      .references(() => discoveredResources.id, { onDelete: 'cascade' }),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => sourceEndpoints.id, { onDelete: 'cascade' }),
    externalId: text('external_id'),
    publishedAt: nullableTimestampColumn('published_at'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    observedAt: timestamp('observed_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('discovery_observations_resource_idx').on(table.discoveredResourceId),
    index('discovery_observations_endpoint_observed_at_idx').on(table.endpointId, table.observedAt),
  ],
);
