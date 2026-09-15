/**
 * Ingestion schema.
 *
 * Sources, technical endpoints, endpoint health, discovery identity,
 * discovery observations, provenance lineage, raw acquisition artifacts,
 * and structured extraction results.
 *
 * The canonical content layer (content_items, content_versions) lives in
 * the `content/` subdirectory.
 */
export * from './sources.js';
export * from './source-endpoints.js';
export * from './source-endpoint-health.js';
export * from './discovered-resources.js';
export * from './discovery-observations.js';
export * from './provenance-events.js';
export * from './raw-resources.js';
export * from './source-items.js';
