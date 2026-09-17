# DB v1 Logical Model Specification v1.0

**Project:** Content Platform  
**Document Type:** Architecture / Database Logical Model  
**Version:** 1.0  
**Status:** Final  
**Scope:** DB v1 core ingestion, provenance, normalization, deduplication, and clustering model

---

## 1. Purpose

This document defines the logical database model for DB v1 of the Content Platform.

The model separates logical sources from their technical endpoints and separates resource identity from individual discovery observations. It provides durable lineage across discovery, acquisition, extraction, normalization, deduplication, and clustering.

The logical model is intentionally independent of PostgreSQL-specific types and Drizzle implementation details. Those belong to the DB v1 Physical Schema Specification.

---

## 2. Core Model

```text
Source
  │
  └── 1:N ── SourceEndpoint
                │
                ├── 1:1 ── EndpointHealth
                │
                └── 1:N ── DiscoveryObservation
                               │
                               ▼
                      DiscoveredResource
                               │
                               └── 1:N ── RawResource
                                              │
                                              ▼
                                         SourceItem
                                              │
                                              ▼
                                         ContentItem
                                           │  │  │
                                           │  │  └── ContentFingerprints
                                           │  │
                                           │  └───── ContentVersions
                                           │
                                           ├──────── ContentUrls
                                           ├──────── DuplicateMatches
                                           └── N:M ─ StoryMembers ─ Story

ProvenanceEvent
  └── cross-cutting lineage target for pipeline artifacts and canonical content
```

---

## 3. `sources`

### Identity

`id`

Globally unique identifier for the logical source.

### Cardinality

One record per publisher, brand, or other logical content source.

### Key Attributes

- `id`
- `name`
- `status`
- `reputation_state`
- `priority`
- `safety_limits`
- `created_at`
- `updated_at`

### Status

- `ACTIVE`
- `PAUSED`
- `DISABLED`

### Reputation State

- `VERIFIED`
- `NEUTRAL`
- `FLAGGED`

### Uniqueness

`name` is unique.

### Relationships

```text
Source 1:N SourceEndpoint
Source 1:N SourceItem
```

### Lifecycle

Managed by operators or administrative tooling.

---

## 4. `source_endpoints`

A SourceEndpoint represents a concrete technical access point belonging to a logical Source.

One Source may expose multiple endpoints for different discovery, acquisition, or extraction strategies.

Examples:

```text
Example News
├── RSS endpoint
├── Sitemap endpoint
└── HTML endpoint
```

### Identity

`id`

### Cardinality

Many endpoints belong to one Source.

### Key Attributes

- `id`
- `source_id`
- `representation`
- `capabilities`
- `url`
- `status`
- `next_poll_at`
- `state_version`
- `state`
- `created_at`
- `updated_at`

### Representation

- `XML`
- `HTML`
- `JSON`
- `UNKNOWN`

### Capabilities

The endpoint may support one or more of:

- `DISCOVERY`
- `ACQUISITION`
- `EXTRACTION`

### State

`state` is a polymorphic endpoint state represented as a discriminated structure.

Supported logical variants:

- `FEED`
- `SITEMAP`
- `PAGINATION`
- `API`
- `STATELESS`

The discriminator is `kind`.

Examples of state-specific information include:

- `lastItemId`
- `lastPublishedAt`
- `lastHash`
- `lastSeenUrl`
- `lastModified`
- `pageCursor`
- `nextPageToken`
- `lastOffset`

### Concurrency

Endpoint state is updated using optimistic locking through `state_version`.

A state update must only succeed when the persisted version matches the version observed by the worker.

### Uniqueness

`(source_id, url)`

### Lifecycle

Tied to source configuration. Endpoint configuration and state are independently mutable from source-level administrative state.

---

## 5. `source_endpoint_health`

Operational health information for a SourceEndpoint.

### Identity

`endpoint_id`

The endpoint identifier is also the primary identity of the 1:1 health extension.

### Cardinality

Exactly one health record may exist for an endpoint.

### Key Attributes

- `endpoint_id`
- `consecutive_failures`
- `last_success_at`
- `last_failure_at`
- `last_error_category`
- `last_error_message`
- `items_today`
- `updated_at`

### Invariants

- `consecutive_failures >= 0`
- `items_today >= 0`

### Lifecycle

Operational state associated with the endpoint. Deleted automatically with the endpoint.

---

## 6. `discovered_resources`

A DiscoveredResource represents the canonical candidate identity discovered by the ingestion system.

It is distinct from the individual observation that found it.

### Identity

`id`

### Cardinality

A canonical candidate may have multiple discovery observations.

```text
DiscoveredResource 1:N DiscoveryObservation
```

### Key Attributes

- `id`
- `canonical_url`
- `external_id`
- `published_at`
- `metadata`
- `created_at`
- `updated_at`

### Canonical URL

`canonical_url` is the normalized identity URL of the candidate.

It is unique at the DiscoveredResource level.

Multiple endpoints discovering the same URL therefore reference the same candidate resource rather than creating multiple resource identities.

---

## 7. `discovery_observations`

A DiscoveryObservation records an individual detection of a DiscoveredResource through a particular SourceEndpoint.

This is the mechanism that preserves multi-path discovery.

Example:

```text
DiscoveredResource #123
├── Observation: RSS endpoint
├── Observation: Sitemap endpoint
└── Observation: HTML listing endpoint
```

### Identity

`id`

### Cardinality

```text
DiscoveredResource 1:N DiscoveryObservation
SourceEndpoint 1:N DiscoveryObservation
```

### Key Attributes

- `id`
- `discovered_resource_id`
- `endpoint_id`
- `external_id`
- `published_at`
- `metadata`
- `observed_at`

The Source is derived through the endpoint relationship and is therefore not duplicated here.

### Lifecycle

Immutable observation records representing detection events.

---

## 8. `provenance_events`

Provenance is a first-class immutable lineage log.

A provenance event records how an artifact or canonical content entity entered or progressed through the pipeline.

### Identity

`id`

### Key Attributes

- `id`
- `target_entity_type`
- `target_entity_id`
- `endpoint_id`
- `phase`
- `method`
- `artifact_hash`
- `observed_at`

### Phase

- `DISCOVERY`
- `ACQUISITION`
- `EXTRACTION`

### Target Entity Types

- `DISCOVERED_RESOURCE`
- `RAW_RESOURCE`
- `SOURCE_ITEM`
- `CONTENT_ITEM`
- `CONTENT_VERSION`

### Relationship Model

The target is represented polymorphically by `target_entity_type` + `target_entity_id`.

This is intentional because provenance spans multiple pipeline artifact types.

### Lifecycle

Immutable. Provenance events are never updated as part of normal pipeline processing.

---

## 9. `raw_resources`

A RawResource is an operational acquisition artifact containing the raw representation retrieved for a discovered resource.

### Identity

`id`

### Cardinality

One DiscoveredResource may have multiple RawResource snapshots because acquisition may occur multiple times.

```text
DiscoveredResource 1:N RawResource
```

### Key Attributes

- `id`
- `discovered_resource_id`
- `url`
- `content_type`
- `body`
- `fetched_at`

### Lifecycle

Retained for operational diagnostics, retries, auditability, and re-extraction workflows.

A failed or non-artifact-producing acquisition does not necessarily create a RawResource.

---

## 10. `source_items`

A SourceItem is the structured result of extraction before platform-level normalization.

### Identity

`id`

### Cardinality

One SourceItem represents one extraction result.

A Source may contain many SourceItems.

### Key Attributes

- `id`
- `source_id`
- `source_item_id`
- `source_url`
- `title`
- `description`
- `content`
- `author`
- `language`
- `published_at`
- `discovered_at`
- `raw_resource_id`
- `content_item_id`

### Uniqueness

`(source_id, source_item_id)`

### Pipeline Relationships

`raw_resource_id` is nullable because inline extraction may not require a RawResource.

`content_item_id` is nullable until normalization maps the SourceItem to a canonical ContentItem.

---

## 11. `content_items`

A ContentItem is the platform's canonical content identity.

It is independent of any single SourceItem or discovery path.

### Identity

`id`

### Key Attributes

- `id`
- `canonical_url`
- `status`
- `published_at`
- `current_version_id`
- `created_at`
- `updated_at`

### Status

- `DRAFT`
- `PUBLISHED`
- `ARCHIVED`
- `TRASHED`

### Canonical URL

`canonical_url` is unique within the canonical content identity layer.

Alternate URLs are represented through `content_urls`.

### Versioning

The current canonical representation is referenced through `current_version_id`.

Historical representations are retained in `content_versions`.

---

## 12. `content_urls`

ContentUrl maps alternate URLs to a canonical ContentItem.

### Identity

`id`

### Cardinality

```text
ContentItem 1:N ContentUrl
```

### Key Attributes

- `id`
- `content_item_id`
- `url`
- `url_kind`

### URL Kinds

- `ALIAS`
- `AMP`
- `TRACKING_VARIANT`

### Uniqueness

`url` is unique across the platform.

The canonical URL itself is owned by `content_items.canonical_url` and is not duplicated as a `CANONICAL` ContentUrl row.

---

## 13. `content_versions`

A ContentVersion stores a concrete normalized representation of a ContentItem at a particular processing revision.

### Identity

`id`

### Cardinality

```text
ContentItem 1:N ContentVersion
```

### Key Attributes

- `id`
- `content_item_id`
- `version_number`
- `title`
- `content`
- `processing_version`
- `created_at`

### Uniqueness

`(content_item_id, version_number)`

### Invariants

`version_number > 0`

### Lifecycle

Immutable after creation.

---

## 14. `content_fingerprints`

ContentFingerprint stores structural fingerprints used for duplicate detection.

### Identity

`id`

### Cardinality

A ContentItem may have multiple fingerprints generated by different algorithms.

### Key Attributes

- `id`
- `content_item_id`
- `algorithm`
- `fingerprint_value`
- `normalized_length`
- `created_at`

### Supported Algorithm Classes

The initial logical vocabulary includes:

- `SHA256`
- `SIMHASH`
- `MINHASH`
- `EMBEDDING`

The exact physical representation of an embedding fingerprint may differ from textual hashes.

### Uniqueness

`(content_item_id, algorithm, fingerprint_value)`

### Indexing

Lookup is optimized by:

```text
(algorithm, fingerprint_value)
```

---

## 15. `duplicate_matches`

DuplicateMatch records evidence that two distinct ContentItems represent duplicate or substantially equivalent content.

### Identity

`id`

### Relationships

```text
ContentItem 1:N DuplicateMatch as canonical item
ContentItem 1:N DuplicateMatch as duplicate item
```

### Key Attributes

- `id`
- `canonical_item_id`
- `duplicate_item_id`
- `similarity_score`
- `detection_method`
- `created_at`

### Invariants

- `0.0 <= similarity_score <= 1.0`
- `canonical_item_id != duplicate_item_id`

### Uniqueness

`(canonical_item_id, duplicate_item_id, detection_method)`

### Purpose

The relationship preserves duplicate-detection evidence separately from canonical identity resolution.

---

## 16. `stories`

A Story is a thematic grouping of related canonical ContentItems.

Clustering is independent of Source identity.

### Identity

`id`

### Key Attributes

- `id`
- `title`
- `summary`
- `status`
- `created_at`
- `updated_at`

### Status

- `FORMING`
- `ACTIVE`
- `ARCHIVED`
- `LOCKED`

### Lifecycle

Stories may evolve as new ContentItems are discovered and clustered.

---

## 17. `story_members`

StoryMember is the N:M relationship between Stories and ContentItems.

### Identity

`id`

### Cardinality

```text
Story N:M ContentItem
```

### Key Attributes

- `id`
- `story_id`
- `content_item_id`
- `relevance_score`
- `membership_type`
- `assignment_method`
- `added_at`

### Membership Type

- `PRIMARY`
- `MENTIONED`

### Assignment Method

- `AUTOMATIC`
- `MANUAL`

### Invariants

`0.0 <= relevance_score <= 1.0`

### Uniqueness

`(story_id, content_item_id)`

---

## 18. Relationship and Delete Semantics

The logical relationship model is:

```text
Source
  └── SourceEndpoint
        ├── SourceEndpointHealth
        └── DiscoveryObservation
              └── DiscoveredResource
                    └── RawResource
                          └── SourceItem
                                └── ContentItem
                                      ├── ContentVersion
                                      ├── ContentUrl
                                      ├── ContentFingerprint
                                      ├── DuplicateMatch
                                      └── StoryMember
                                            └── Story
```

Ownership-oriented relationships are cascade-deletable where appropriate.

Operational and intermediate artifacts are therefore removed with their owning identity when that identity is intentionally deleted.

Provenance remains a cross-cutting audit structure and uses nullable endpoint references so that lineage records can survive endpoint deletion where required by the physical schema.

---

## 19. Query Patterns

The DB v1 logical model is designed around these primary access patterns.

### Endpoint scheduling

Find active endpoints whose next poll is due:

```text
SourceEndpoint.status = ACTIVE
AND next_poll_at <= now()
ORDER BY priority / scheduling policy
```

### Canonical resource lookup

Resolve a normalized discovery URL to an existing DiscoveredResource.

### Multi-path discovery

Retrieve all observations associated with a DiscoveredResource.

### Source item idempotency

Resolve a SourceItem through:

```text
(source_id, source_item_id)
```

### Canonical content lookup

Resolve canonical content through `canonical_url`.

### Alternate URL lookup

Resolve an alias, AMP, or tracking URL through `content_urls`.

### Fingerprint lookup

Find potentially duplicate ContentItems through:

```text
(algorithm, fingerprint_value)
```

### Duplicate relationship lookup

Find canonical or duplicate relationships for a ContentItem.

### Story membership

Retrieve ContentItems belonging to a Story in membership order.

### Provenance trace

Retrieve the complete lineage associated with a pipeline artifact or ContentItem through:

```text
(target_entity_type, target_entity_id)
```

---

## 20. Explicit Non-Goals of DB v1

The following are deliberately outside this logical model:

- publisher-specific HTML extraction schemas
- crawler implementation details
- HTTP client configuration
- headless browser implementation
- queue implementation details
- Redis/BullMQ internals
- AI model implementation
- embedding storage implementation details
- publication destination implementation
- scheduling policy implementation
- authentication and authorization schema
- moderation workflow schema
- media/image processing schema

These may be represented by later database modules without changing the core ingestion identity model.

---

## 21. Architectural Invariants

The following invariants define DB v1:

1. A Source is a logical publisher/brand, not a technical endpoint.
2. A Source may have multiple SourceEndpoints.
3. Endpoint state is endpoint-specific and polymorphic.
4. Endpoint state uses optimistic concurrency control.
5. A DiscoveredResource represents candidate identity, not an individual observation.
6. Multiple endpoints may observe the same DiscoveredResource.
7. Discovery observations preserve multi-path discovery history.
8. Provenance is immutable and cross-cutting.
9. Raw acquisition artifacts may have multiple snapshots per resource.
10. SourceItems are intermediate extraction artifacts.
11. ContentItems represent platform-level canonical identity.
12. Canonical URLs and alternate URLs are distinct concepts.
13. Content versions are immutable historical representations.
14. Fingerprints are independent of URL identity.
15. Duplicate relationships preserve detection evidence.
16. Stories are independent of Source identity.
17. Story membership is an explicit N:M relationship.
18. Operational endpoint health is separated from endpoint configuration.
19. PostgreSQL-specific physical details are derived from this logical model rather than redefining it.
20. The model must remain compatible with RSS, Atom, Sitemap, HTML listing, API, and direct-seed discovery strategies.

## 21. Worker Execution and Operational Observability

DB v1 does not persist every worker execution attempt as a canonical database entity.

Transient queue state, retry metadata, execution timing, and worker-level diagnostic information are owned by the Redis/BullMQ execution layer.

PostgreSQL remains authoritative for durable pipeline state, canonical artifacts, provenance, and endpoint health.

A future `EndpointRun` or equivalent execution-history entity may be introduced when operational requirements justify persistent execution analytics, historical run metrics, SLA analysis, or long-term diagnostics.

Such an entity must not become a duplicate representation of Redis/BullMQ queue state.

This boundary is intentional: Redis/BullMQ owns transient execution concerns, scheduling, and worker execution attempts, while PostgreSQL owns durable state and canonical platform data.
