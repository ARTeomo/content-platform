/**
 * Ingestion schema.
 *
 * Sources, technical endpoints, and endpoint health. The discovery,
 * acquisition, and extraction artifact tables (`discovered_resources`,
 * `raw_resources`, `source_items`, ...) arrive in later phases.
 */
export * from './sources.js';
export * from './source-endpoints.js';
export * from './source-endpoint-health.js';
