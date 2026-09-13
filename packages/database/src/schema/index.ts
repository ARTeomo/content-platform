/**
 * Central schema export.
 *
 * Every Drizzle table definition must be re-exported from this file so that:
 *   - drizzle-kit discovers all tables during migration generation;
 *   - the runtime client receives the full schema for relational queries.
 *
 * Planned file layout (tables added incrementally per
 * DATABASE_SCHEMA_CONTRACT.md §20 migration order):
 *
 *   schema/
 *   ├── _common.ts             shared column builders
 *   ├── index.ts               this file
 *   ├── identity/              roles, users
 *   ├── publication/           destinations, publication_candidates,
 *   │                          publications, publication_attempts,
 *   │                          publication_reconciliations
 *   ├── ingestion/             sources, source_endpoints,
 *   │                          source_endpoint_health, discovered_resources,
 *   │                          discovery_observations, provenance_events,
 *   │                          raw_resources, source_items
 *   ├── content/               content_items, content_urls, content_versions,
 *   │                          content_entities, content_categories,
 *   │                          content_fingerprints, duplicate_matches
 *   ├── story/                 stories, story_members
 *   ├── moderation/            moderation_actions,
 *   │                          interaction_moderation_actions
 *   ├── media/                 images, image_rights
 *   ├── webhook/               webhook_subscriptions,
 *   │                          webhook_subscription_health,
 *   │                          webhook_events, webhook_deliveries,
 *   │                          external_interactions
 *   ├── interaction/           interaction_responses,
 *   │                          interaction_response_attempts,
 *   │                          interaction_response_reconciliations
 *   ├── credential/            provider_credentials
 *   ├── config/                system_config, config_audit_log
 *   ├── observability/         ai_usage, system_logs, notifications,
 *   │                          audit_logs
 *   └── platform/              outbox_jobs
 *
 * Phase 2 begins with:
 *   - identity/roles.ts
 *   - identity/users.ts
 *   - publication/destinations.ts
 */

// Intentionally empty during Phase 1.
// Table exports begin in Phase 2.
// Phase 2 — foundation tables
export * from './identity/index.js';
export * from './publication/index.js';
