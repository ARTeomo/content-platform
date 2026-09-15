/**
 * Ingestion schema.
 *
 * Sources, technical endpoints, endpoint health, discovery identity,
 * discovery observations, provenance lineage, and raw acquisition
 * artifacts.
 *
 * The pipeline artifact tables (source_items, content_items, ...) arrive
 * in later phases.
 */
export * from './sources.js';
export * from './source-endpoints.js';
export * from './source-endpoint-health.js';
export * from './discovered-resources.js';
export * from './discovery-observations.js';
export * from './provenance-events.js';
export * from './raw-resources.js';
