# Content Platform — Database Schema Contract

**Version:** 1.2
**Status:** Production-Ready DB v1 Persistence Contract
**Normative:** Yes — implementation baseline
**Based on:** DB v1 Logical Model Specification v1.0, Technical Design Specification v0.9.0, DATABASE_SCHEMA_CONTRACT.md v1.0 and v1.1, and the established platform persistence model
**Scope:** PostgreSQL persistence model for the Content Platform. DB v1 distinguishes the 15-table core logical model defined by the DB v1 Logical Model Specification from supporting platform persistence tables that remain required by the established technical design.

**Revision 1.1** extends the v1.0 contract with the inbound Meta integration persistence slice: webhook subscription, webhook event receipt, webhook delivery attempts, external interaction materialization, provider credential storage, interaction response lifecycle, and a unified transactional outbox. These additions are **outside** the DB v1 Logical Model Specification scope and do not alter the core ingestion model, its invariants, or the persistence contract of v1.0.

**Revision 1.2** adds webhook subscription operational health persistence, a hot-path publication lookup index, and documentation refinements to three deferred decisions. It does not alter the inbound aggregate boundary, the interaction natural key, or any table introduced by v1.1. All v1.2 changes are additive or documentation-only.

---

## 1. Purpose

This document defines the physical PostgreSQL persistence contract for DB v1 of the Content Platform.

It translates the finalized DB v1 Logical Model Specification into explicit relational tables, columns, foreign keys, uniqueness rules, indexes, lifecycle constraints, deletion behavior, and migration requirements.

The logical model remains the architectural source of truth for entity meaning and relationships. This document is the authoritative source for PostgreSQL-specific persistence decisions that implement that logical model.

The database contract must not redefine the logical domain model. Supporting platform tables may be included where they are required by the established technical design, but they are explicitly identified as outside the core logical model.

### Source-of-truth hierarchy

1. Domain and architecture contracts
2. `DB v1 Logical Model Specification v1.0`
3. This `DATABASE_SCHEMA_CONTRACT.md`
4. Drizzle schema implementation
5. Generated PostgreSQL migrations

If a higher-level architectural contract changes, this document must be revised before the dependent Drizzle schema or migrations are changed.

---

## 2. Database Principles

- PostgreSQL is the authoritative durable system of record.
- Redis/BullMQ is the asynchronous execution layer and is not authoritative business state.
- Worker execution attempts, retry metadata, transient execution timing, and worker-level diagnostics are not canonical PostgreSQL entities in DB v1.
- All timestamps use `timestamptz` and represent UTC instants.
- Database-generated entity identifiers use UUIDs unless an external identifier is explicitly represented as text.
- Lifecycle states are persisted as text values and validated by database constraints where the vocabulary is finalized.
- Structurally variable configuration and metadata use `jsonb`.
- Endpoint state is persisted as `jsonb` because it is polymorphic and endpoint-specific.
- Foreign keys enforce relational integrity.
- Unique constraints enforce deterministic business identities.
- Immutable history and provenance records are append-oriented.
- Secrets are not stored as plaintext in ordinary application tables.
- Operational health is separated from endpoint configuration.
- Canonical content identity is separated from source and discovery identity.
- Discovery observations are preserved separately from canonical discovered-resource identity.
- Raw acquisition artifacts may have multiple snapshots for the same discovered resource.
- PostgreSQL-specific implementation details must not change the logical meaning of the model.
- Production schema changes follow `EXPAND → MIGRATE → SWITCH → CONTRACT`.

### New in v1.1

- **Transactional outbox is a platform-level primitive.** Every asynchronous side effect produced by a durable domain transition is enqueued through `outbox_jobs` inside the same PostgreSQL transaction that commits the domain state. No direct Redis enqueue is permitted on a durable-write hot path.
- **Inbound external events are append-oriented receipts.** The raw payload of an external event is immutable after receipt. Processing state is a narrow, explicitly modeled mutation.
- **Provider credentials are encrypted at rest with application-managed keys.** No plaintext secret is persisted in any ordinary application table, log, audit record, or cache beyond the minimum necessary in-memory lifetime of a single operation.
- **External identifiers are idempotency anchors.** Every inbound external event carries an `idempotency_key`; every outbound external side effect carries a deterministic `job_id`; every materialized external entity carries a natural external identifier with a unique constraint.

### New in v1.2

- **Operational health is separated from inbound subscription configuration**, mirroring the separation already established for source endpoints. High-frequency health updates never rewrite relatively stable subscription configuration.

---

## 3. DB v1 Persistence Tables

DB v1 contains **44 persistence tables**, organized into six categories.

### 3.1 Core logical model (15 tables)

Defined by the DB v1 Logical Model Specification v1.0. Unchanged in v1.1 and v1.2.

```text
sources
source_endpoints
source_endpoint_health
discovered_resources
discovery_observations
provenance_events
raw_resources
source_items
content_items
content_urls
content_versions
content_fingerprints
duplicate_matches
stories
story_members
```

### 3.2 Supporting platform persistence (18 tables)

Required by the wider platform architecture. Unchanged in v1.1 and v1.2.

```text
roles
users
content_entities
content_categories
images
image_rights
destinations
publication_candidates
publications
publication_attempts
publication_reconciliations
moderation_actions
system_config
config_audit_log
ai_usage
system_logs
notifications
audit_logs
```

### 3.3 Inbound event persistence (4 tables) — NEW in v1.1

Persists external push events received from the Meta Platform, their processing attempts, and the materialized interaction entities derived from them.

```text
webhook_subscriptions
webhook_events
webhook_deliveries
external_interactions
```

The operational health of each subscription is persisted in `webhook_subscription_health` (§3.3.1), following the same separation between configuration and health that DB v1 core applies to source endpoints.

### 3.3.1 Inbound health companion (1 table) — NEW in v1.2

Operational health companion for inbound webhook subscriptions. Mirrors the `source_endpoint_health` pattern established in DB v1 core and preserves operational history that cannot be reconstructed after the fact.

```text
webhook_subscription_health
```

### 3.4 Provider credentials and interaction response (5 tables) — NEW in v1.1

Persists encrypted provider credentials and the outbound interaction-response lifecycle.

```text
provider_credentials
interaction_responses
interaction_response_attempts
interaction_moderation_actions
interaction_response_reconciliations
```

### 3.5 Platform patterns (1 table) — NEW in v1.1

A unified transactional outbox used by every durable domain transition that must produce an asynchronous side effect.

```text
outbox_jobs
```

### 3.6 Removed legacy tables

The following legacy source-ingestion tables are **not part of DB v1**:

```text
source_cursors
source_health
```

Their responsibilities are replaced by endpoint-specific state and endpoint health. They must not be recreated as compatibility aliases in the DB v1 schema. Any compatibility logic belongs outside the production persistence model and must not create a second source of truth.

### 3.7 Architectural responsibility transfer

DB v1 deliberately moves technical ingestion state and operational health from the logical Source level to the technical SourceEndpoint level. This is a structural responsibility transfer, not merely a table rename or deletion.

```text
Legacy model            DB v1
Source                  Source
├── source_cursors      └── SourceEndpoint
└── source_health           ├── state + state_version
                            └── SourceEndpointHealth
```

The rationale is normative:

1. A Source represents a logical publisher, brand, or other content source. It must not carry technical state that may differ between access mechanisms.
2. A Source may expose multiple endpoints, and each endpoint may have independent incremental state. An RSS feed cursor, sitemap position, pagination cursor, or API token is therefore endpoint-specific.
3. Endpoint health is also endpoint-specific. Failure of one endpoint must not imply failure of the logical Source when another endpoint remains healthy.
4. Separating endpoint health from endpoint configuration prevents high-frequency operational updates from rewriting relatively stable endpoint configuration data.
5. `state_version` provides optimistic concurrency control for endpoint-specific incremental state and prevents concurrent workers from overwriting newer state.
6. `source_cursors` and source-level `source_health` must not be recreated as compatibility aliases in the DB v1 schema.

The v1.1 and v1.2 additions do not alter this transfer. The `webhook_subscription_health` table applies the same separation principle to inbound webhook subscriptions.

### 3.8 Table count summary

```text
15  core logical model
18  supporting platform persistence
 4  inbound event persistence        (new in v1.1)
 1  inbound health companion         (new in v1.2)
 5  provider credentials + response  (new in v1.1)
 1  platform pattern (outbox)        (new in v1.1)
---
44  total
```

---

## 4. Common Physical Conventions

### 4.1 Primary keys

Entity tables use:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
```

The `pgcrypto` extension is therefore required. It is created by the baseline migration and is never re-declared in subsequent migrations.

An exception is `system_config`, whose primary key is the configuration key itself (text), not a surrogate UUID.

### 4.2 Timestamps

Temporal fields use:

```sql
timestamptz
```

Business timezone conversion belongs to application-level scheduling logic.

### 4.3 Text and enumerated values

Domain state values are stored as text. PostgreSQL enums are not required for DB v1 unless a later architectural decision explicitly introduces them.

Where a vocabulary is finalized, `CHECK` constraints may enforce it directly in the database.

### 4.4 JSONB

`jsonb` is used for structurally variable data such as:

- source safety limits;
- endpoint configuration;
- endpoint state;
- discovery metadata;
- provenance-adjacent metadata where explicitly defined;
- publication reconciliation details;
- system configuration values;
- audit changes and metadata;
- operational log metadata;
- webhook raw payloads;
- interaction raw metadata;
- outbox job payloads.

JSONB must not be used to hide relational identity, foreign-key relationships, or fields that require normal indexed lookup.

### 4.5 Deletion

The default policy is to prefer lifecycle transitions such as `DISABLED`, `ARCHIVED`, or `TRASHED` over physical deletion.

Ownership-oriented operational artifacts may use cascade deletion where the logical model explicitly permits it. Durable business history and audit records must not be silently removed as a side effect of ordinary lifecycle operations.

### 4.6 Secrets (NEW in v1.1)

No plaintext secret may be persisted in any ordinary application table. Secrets are stored only in `provider_credentials.encrypted_value` and are encrypted with application-managed keys whose versions are tracked in `provider_credentials.encryption_key_version`. The `webhook_subscriptions.verify_token_encrypted` column follows the same rule with a distinct encryption key.

### 4.7 Idempotency keys (NEW in v1.1)

Every deterministic business identity that can be reproduced by a retry must be expressed as a database-enforced uniqueness constraint. Inbound external events use `webhook_events.idempotency_key`. Queued side effects use `outbox_jobs.job_id`. Materialized external entities use `(interaction_type, external_interaction_id)` and similar natural external identifiers.

---

## 5. Table Contracts

### 5.1 `roles`

Purpose: authenticated application roles.

`roles` is a supporting platform persistence table. It is intentionally outside the DB v1 Logical Model Specification because authentication and authorization schema are explicit non-goals of that document.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `name` | text | no | — | UNIQUE |
| `description` | text | yes | — | — |
| `created_at` | timestamptz | no | now | — |

Canonical role names:

```text
VIEWER
EDITOR
PUBLISHER
ADMIN
```

---

### 5.2 `users`

Purpose: authenticated application users.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `email` | text | no | — | UNIQUE |
| `password_hash` | text | no | — | — |
| `display_name` | text | no | — | — |
| `role_id` | uuid | no | — | FK → `roles.id` |
| `is_active` | boolean | no | true | — |
| `created_at` | timestamptz | no | now | — |
| `updated_at` | timestamptz | no | now | — |

Plaintext passwords are prohibited.

---

### 5.3 `sources`

Purpose: logical publisher, brand, or other content source.

A Source is **not** a technical endpoint. Endpoint-specific access information belongs to `source_endpoints`.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `name` | text | no | — | UNIQUE |
| `status` | varchar(32) | no | — | `ACTIVE`, `PAUSED`, `DISABLED` |
| `reputation_state` | varchar(32) | no | — | `VERIFIED`, `NEUTRAL`, `FLAGGED` |
| `priority` | integer | no | 100 | — |
| `safety_limits` | jsonb | no | `{}` | — |
| `created_at` | timestamptz | no | now | — |
| `updated_at` | timestamptz | no | now | — |

`type` and `url` are intentionally absent. They are endpoint properties and therefore belong to `source_endpoints`.

Relationships:

```text
sources 1:N source_endpoints
sources 1:N source_items
```

---

### 5.4 `source_endpoints`

Purpose: concrete technical access point belonging to a Source.

One Source may expose multiple endpoints for different discovery, acquisition, and extraction strategies.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `source_id` | uuid | no | — | FK → `sources.id` |
| `representation` | varchar(32) | no | — | `XML`, `HTML`, `JSON`, `UNKNOWN` |
| `capabilities` | text[] | no | — | domain-validated capability values |
| `url` | text | no | — | — |
| `status` | varchar(32) | no | — | `ACTIVE`, `PAUSED`, `DISABLED` |
| `next_poll_at` | timestamptz | no | now | — |
| `state_version` | integer | no | 0 | `>= 0` |
| `state` | jsonb | no | `{"kind":"STATELESS"}` | discriminated endpoint state |
| `created_at` | timestamptz | no | now | — |
| `updated_at` | timestamptz | no | now | — |

Unique constraint:

```text
(source_id, url)
```

Representation values:

```text
XML
HTML
JSON
UNKNOWN
```

Capabilities are drawn from:

```text
DISCOVERY
ACQUISITION
EXTRACTION
```

### Endpoint state

`state` is the persisted representation of the polymorphic `EndpointState` model.

The JSON object contains a discriminator:

```text
kind
```

Supported logical kinds:

```text
FEED
SITEMAP
PAGINATION
API
STATELESS
```

Examples of state-specific values include:

```text
lastItemId
lastPublishedAt
lastHash
lastSeenUrl
lastModified
pageCursor
nextPageToken
lastOffset
```

The database does not flatten these fields into a fixed set of nullable columns. The state shape is polymorphic and may evolve as additional endpoint strategies are introduced. Every persisted state must contain the `kind` discriminator and conform to the corresponding logical endpoint-state variant.

### Optimistic locking

`state_version` provides optimistic concurrency control.

A worker may update endpoint state only if the persisted `state_version` still equals the version observed when the worker read the endpoint.

A successful update increments `state_version`.

### Scheduler index

The scheduler must be able to efficiently select due active endpoints:

```text
(status, next_poll_at)
```

---

### 5.5 `source_endpoint_health`

Purpose: operational health extension for a SourceEndpoint.

The table is a strict 1:1 extension of `source_endpoints`.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `endpoint_id` | uuid | no | — | PK, FK → `source_endpoints.id` ON DELETE CASCADE |
| `consecutive_failures` | integer | no | 0 | `>= 0` |
| `last_success_at` | timestamptz | yes | — | — |
| `last_failure_at` | timestamptz | yes | — | — |
| `last_error_category` | varchar(64) | yes | — | — |
| `last_error_message` | text | yes | — | — |
| `items_today` | integer | no | 0 | `>= 0` |
| `updated_at` | timestamptz | no | now | — |

`items_today` provides database-backed endpoint operational counter state. The application/transaction layer defines the reset and limit-enforcement semantics.

Health is intentionally separated from endpoint configuration and endpoint state so high-frequency operational updates do not require rewriting endpoint configuration data.

The health record is removed with its owning endpoint when an endpoint is intentionally deleted.

---

### 5.6 `discovered_resources`

Purpose: canonical candidate identity created by discovery.

A DiscoveredResource represents a candidate resource independently of the observation path that found it.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `canonical_url` | text | no | — | UNIQUE |
| `external_id` | text | yes | — | — |
| `published_at` | timestamptz | yes | — | — |
| `metadata` | jsonb | no | `{}` | — |
| `created_at` | timestamptz | no | now | — |
| `updated_at` | timestamptz | no | now | — |

`canonical_url` is the normalized candidate identity and is unique at this layer.

Multiple endpoints discovering the same normalized URL reference the same `discovered_resources` row.

---

### 5.7 `discovery_observations`

Purpose: immutable record of an individual discovery of a DiscoveredResource through a SourceEndpoint.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `discovered_resource_id` | uuid | no | — | FK → `discovered_resources.id` ON DELETE CASCADE |
| `endpoint_id` | uuid | no | — | FK → `source_endpoints.id` ON DELETE CASCADE |
| `external_id` | text | yes | — | — |
| `published_at` | timestamptz | yes | — | — |
| `metadata` | jsonb | no | `{}` | — |
| `observed_at` | timestamptz | no | now | — |

The Source is derived through:

```text
discovery_observations.endpoint_id
    → source_endpoints.source_id
    → sources.id
```

`source_id` is therefore not duplicated in this table.

Observations are immutable detection records. There is no `updated_at`.

---

### 5.8 `provenance_events`

Purpose: immutable cross-cutting lineage log.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `target_entity_type` | varchar(64) | no | — | domain-validated |
| `target_entity_id` | uuid | no | — | polymorphic target identifier |
| `endpoint_id` | uuid | yes | — | FK → `source_endpoints.id`, `ON DELETE SET NULL` |
| `phase` | varchar(32) | no | — | `DISCOVERY`, `ACQUISITION`, `EXTRACTION` |
| `method` | varchar(64) | no | — | phase-compatible operation method |
| `artifact_hash` | varchar(128) | yes | — | optional integrity value |
| `observed_at` | timestamptz | no | now | — |

Target entity types:

```text
DISCOVERED_RESOURCE
RAW_RESOURCE
SOURCE_ITEM
CONTENT_ITEM
CONTENT_VERSION
```

The target is intentionally represented by:

```text
target_entity_type + target_entity_id
```

because provenance spans multiple artifact types. A polymorphic target cannot be represented by a conventional PostgreSQL foreign key without sacrificing the multi-target model.

The endpoint reference is nullable so provenance can survive intentional endpoint deletion where required.

Provenance events are immutable. There is no `updated_at`.

---

### 5.9 `raw_resources`

Purpose: raw acquisition artifact retained for diagnostics, retries, auditability, and re-extraction.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `discovered_resource_id` | uuid | no | — | FK → `discovered_resources.id` ON DELETE CASCADE |
| `url` | text | no | — | — |
| `content_type` | varchar(128) | no | — | — |
| `body` | text | no | — | raw payload representation |
| `fetched_at` | timestamptz | no | now | — |

One DiscoveredResource may have multiple RawResource snapshots.

A failed acquisition that does not produce a raw artifact does not require a `raw_resources` row.

The acquisition event itself is represented through provenance and operational execution infrastructure rather than through a separate canonical worker-attempt entity.

There is no `updated_at`.

---

### 5.10 `source_items`

Purpose: structured extraction result before platform-level normalization.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `source_id` | uuid | no | — | FK → `sources.id` ON DELETE CASCADE |
| `source_item_id` | text | no | — | UNIQUE with `source_id` |
| `source_url` | text | no | — | — |
| `title` | text | no | — | — |
| `description` | text | yes | — | — |
| `content` | text | no | — | — |
| `author` | text | yes | — | — |
| `language` | text | yes | — | — |
| `published_at` | timestamptz | yes | — | — |
| `discovered_at` | timestamptz | no | now | — |
| `raw_resource_id` | uuid | yes | — | FK → `raw_resources.id` ON DELETE SET NULL |
| `content_item_id` | uuid | yes | — | FK → `content_items.id` ON DELETE SET NULL |

Unique constraint:

```text
(source_id, source_item_id)
```

`raw_resource_id` is nullable because inline extraction may not require acquisition.

`content_item_id` is nullable until normalization maps the SourceItem to canonical platform content.

There is no `updated_at` because SourceItems are not edited in place.

---

### 5.11 `content_items`

Purpose: platform-level canonical content identity.

A ContentItem is independent of any single SourceItem, source endpoint, or discovery URL.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `canonical_url` | text | no | — | UNIQUE |
| `status` | varchar(32) | no | — | `DRAFT`, `PUBLISHED`, `ARCHIVED`, `TRASHED` |
| `published_at` | timestamptz | yes | — | — |
| `current_version_id` | uuid | yes | — | FK → `content_versions.id` ON DELETE SET NULL |
| `created_at` | timestamptz | no | now | — |
| `updated_at` | timestamptz | no | now | — |

The canonical URL belongs to the canonical content identity layer.

Source-specific identity is not stored directly on `content_items`; source lineage is retained through `source_items`, provenance, and related pipeline artifacts.

Historical canonical representations are stored in `content_versions`.

### Mutual FK with `content_versions`

Because `content_items.current_version_id` and `content_versions.content_item_id` form a mutual dependency, migration creation must create the content tables first and add the `current_version_id` foreign key after `content_versions` exists. Drizzle resolves this through a lazy callback and generates the `ALTER TABLE ... ADD CONSTRAINT` statement in the same migration.

---

### 5.12 `content_urls`

Purpose: map alternate URLs to a canonical ContentItem.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `content_item_id` | uuid | no | — | FK → `content_items.id` ON DELETE CASCADE |
| `url` | text | no | — | UNIQUE across platform |
| `url_kind` | varchar(32) | no | — | `ALIAS`, `AMP`, `TRACKING_VARIANT` |

The canonical URL itself is owned by `content_items.canonical_url` and is not duplicated as a `CANONICAL` row in `content_urls`.

The global uniqueness of `url` prevents one alternate URL from being assigned to multiple ContentItems.

---

### 5.13 `content_versions`

Purpose: immutable normalized representation of a ContentItem at a particular processing revision.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `content_item_id` | uuid | no | — | FK → `content_items.id` ON DELETE CASCADE |
| `version_number` | integer | no | — | `> 0`, UNIQUE with content item |
| `title` | text | no | — | — |
| `content` | text | no | — | — |
| `processing_version` | varchar(64) | no | — | — |
| `created_at` | timestamptz | no | now | — |

Unique constraint:

```text
(content_item_id, version_number)
```

`version_number > 0`.

Versions are immutable after creation. There is no `updated_at`.

---

### 5.14 `content_entities`

Purpose: extracted named or typed entities associated with canonical content.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `content_id` | uuid | no | — | FK → `content_items.id` ON DELETE CASCADE |
| `entity_type` | text | no | — | — |
| `entity_value` | text | no | — | — |
| `normalized_value` | text | yes | — | — |
| `confidence` | numeric(5,4) | yes | — | `0..1` |
| `created_at` | timestamptz | no | now | — |

No fixed entity taxonomy is introduced in DB v1.

---

### 5.15 `content_categories`

Purpose: category assignments for canonical content.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `content_id` | uuid | no | — | FK → `content_items.id` ON DELETE CASCADE |
| `category` | text | no | — | — |
| `confidence` | numeric(5,4) | yes | — | `0..1` |
| `created_at` | timestamptz | no | now | — |

Category vocabulary remains domain/configuration-defined.

---

### 5.16 `content_fingerprints`

Purpose: structural fingerprints used by duplicate detection.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `content_item_id` | uuid | no | — | FK → `content_items.id` ON DELETE CASCADE |
| `algorithm` | varchar(64) | no | — | — |
| `fingerprint_value` | varchar(512) | no | — | — |
| `normalized_length` | integer | no | — | — |
| `created_at` | timestamptz | no | now | — |

Initial logical algorithm vocabulary:

```text
SHA256
SIMHASH
MINHASH
EMBEDDING
```

The exact physical representation of an embedding fingerprint may require a later physical specialization. DB v1 must not assume that all algorithms have identical storage semantics beyond the contract above.

Unique constraint:

```text
(content_item_id, algorithm, fingerprint_value)
```

The primary lookup index is:

```text
(algorithm, fingerprint_value)
```

---

### 5.17 `duplicate_matches`

Purpose: preserve evidence that two distinct ContentItems represent duplicate or substantially equivalent content.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `canonical_item_id` | uuid | no | — | FK → `content_items.id` ON DELETE CASCADE |
| `duplicate_item_id` | uuid | no | — | FK → `content_items.id` ON DELETE CASCADE |
| `similarity_score` | real | no | — | `0.0..1.0` |
| `detection_method` | varchar(64) | no | — | — |
| `created_at` | timestamptz | no | now | — |

Invariants:

```text
0.0 <= similarity_score <= 1.0
canonical_item_id != duplicate_item_id
```

Unique constraint:

```text
(canonical_item_id, duplicate_item_id, detection_method)
```

The relationship preserves detection evidence separately from the canonical identity decision.

The physical schema should prevent reciprocal duplicates of the same pair from being represented as two independent relationships where the business model requires pair symmetry. If reciprocal uniqueness cannot be expressed with a simple unique constraint, this invariant must be enforced by an application transaction.

---

### 5.18 `stories`

Purpose: thematic grouping of related canonical ContentItems.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `title` | text | no | — | — |
| `summary` | text | yes | — | — |
| `status` | varchar(32) | no | — | `FORMING`, `ACTIVE`, `ARCHIVED`, `LOCKED` |
| `created_at` | timestamptz | no | now | — |
| `updated_at` | timestamptz | no | now | — |

Stories are independent of Source identity.

---

### 5.19 `story_members`

Purpose: explicit N:M relationship between Stories and ContentItems.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `story_id` | uuid | no | — | FK → `stories.id` ON DELETE CASCADE |
| `content_item_id` | uuid | no | — | FK → `content_items.id` ON DELETE CASCADE |
| `relevance_score` | real | no | — | `0.0..1.0` |
| `membership_type` | varchar(32) | no | — | `PRIMARY`, `MENTIONED` |
| `assignment_method` | varchar(32) | no | — | `AUTOMATIC`, `MANUAL` |
| `added_at` | timestamptz | no | now | — |

Unique constraint:

```text
(story_id, content_item_id)
```

A ContentItem may participate in multiple Stories. DB v1 does not impose a global one-story-only constraint because the finalized logical model explicitly defines an N:M relationship.

There is no `updated_at` because membership rows are immutable after insert.

---

### 5.20 `images`

Purpose: image discovery, resolution, and validation artifacts associated with content.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `content_id` | uuid | yes | — | FK → `content_items.id` ON DELETE SET NULL |
| `source_url` | text | no | — | — |
| `resolved_url` | text | yes | — | — |
| `mime_type` | text | yes | — | — |
| `width` | integer | yes | — | `> 0` |
| `height` | integer | yes | — | `> 0` |
| `file_size_bytes` | bigint | yes | — | `>= 0` |
| `status` | text | no | — | domain-validated |
| `created_at` | timestamptz | no | now | — |

`content_id` is nullable with `ON DELETE SET NULL`: an image may outlive its originating content item for rights and forensic purposes.

The final image status vocabulary remains outside DB v1 logical-model scope (deferred decision D-002).

There is no `updated_at`.

---

### 5.21 `image_rights`

Purpose: rights and attribution evaluation for an image.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `image_id` | uuid | no | — | UNIQUE, FK → `images.id` ON DELETE CASCADE |
| `rights_status` | text | no | — | domain-validated |
| `source_domain` | text | yes | — | — |
| `attribution_required` | boolean | no | false | — |
| `attribution_text` | text | yes | — | — |
| `evaluated_at` | timestamptz | no | now | — |

The exact rights taxonomy remains outside DB v1 logical-model scope (deferred decision D-003).

---

### 5.22 `destinations`

Purpose: persistent identity and lifecycle for an external publication destination.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `name` | text | no | — | — |
| `type` | text | no | — | domain-validated |
| `external_id` | text | no | — | UNIQUE with `type` |
| `is_active` | boolean | no | true | — |
| `created_at` | timestamptz | no | now | — |
| `updated_at` | timestamptz | no | now | — |

Unique constraint:

```text
(type, external_id)
```

Credentials are not stored as plaintext in this table.

---

### 5.23 `publication_candidates`

Purpose: persisted editorial publication candidate.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `content_id` | uuid | no | — | FK → `content_items.id` ON DELETE CASCADE |
| `story_id` | uuid | no | — | FK → `stories.id` ON DELETE CASCADE |
| `version` | integer | no | — | `> 0` |
| `title` | text | no | — | — |
| `caption` | text | no | — | — |
| `summary` | text | no | — | — |
| `source_url` | text | no | — | — |
| `image_id` | uuid | yes | — | FK → `images.id` ON DELETE SET NULL |
| `validation_status` | text | no | — | `PASS`, `FAIL`, `REVIEW` |
| `created_at` | timestamptz | no | now | — |

The candidate stores the content representation intended for publication and is independent from transient worker execution state.

There is no `updated_at` because a candidate is a versioned artifact and edits produce new candidates.

---

### 5.24 `moderation_actions`

Purpose: durable moderation decision history.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `content_id` | uuid | no | — | FK → `content_items.id` ON DELETE CASCADE |
| `candidate_id` | uuid | yes | — | FK → `publication_candidates.id` ON DELETE SET NULL |
| `user_id` | uuid | no | — | FK → `users.id` ON DELETE RESTRICT |
| `action` | text | no | — | domain-validated |
| `reason` | text | yes | — | — |
| `created_at` | timestamptz | no | now | — |

Canonical actions include:

```text
APPROVE
REJECT
EDIT
ARCHIVE
```

There is no `updated_at`. Moderation records are append-only.

---

### 5.25 `publications`

Purpose: durable publication intent and external publication state.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `publication_candidate_id` | uuid | no | — | FK → `publication_candidates.id` ON DELETE RESTRICT |
| `destination_id` | uuid | no | — | FK → `destinations.id` ON DELETE RESTRICT |
| `status` | text | no | `SCHEDULED` | domain-validated |
| `scheduled_at` | timestamptz | yes | — | — |
| `published_at` | timestamptz | yes | — | — |
| `external_post_id` | text | yes | — | — |
| `created_at` | timestamptz | no | now | — |
| `updated_at` | timestamptz | no | now | — |

Publication states:

```text
SCHEDULED
RESERVED
IN_PROGRESS
PUBLISHED
RETRY
FAILED
RECONCILIATION
```

Publication identity must be deterministic at the candidate/content plus destination level. The application lock key is:

```text
publication:{contentId}:{destinationId}
```

A final unique constraint must enforce the same business identity once the publication-candidate/content relationship is resolved by the application model.

Unknown external outcomes must be representable and must not automatically become ordinary failures.

### Hot-path lookup

`external_post_id` is the natural lookup key for the webhook processing pipeline. A partial index on `external_post_id WHERE external_post_id IS NOT NULL` serves that hot path without indexing the majority-null rows.

### No unique constraint on `external_post_id`

`external_post_id` represents a historical external identifier that may legitimately repeat if an external post is deleted and re-created by the provider. No unique constraint is placed on this column in DB v1.2.

---

### 5.26 `publication_attempts`

Purpose: durable publication execution history.

This table is a business-history table for publication side effects. It is not a generic worker execution log and does not duplicate BullMQ retry metadata.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `publication_id` | uuid | no | — | FK → `publications.id` ON DELETE CASCADE |
| `attempt_number` | integer | no | — | `> 0`, UNIQUE with publication |
| `status` | text | no | — | domain-validated |
| `started_at` | timestamptz | yes | — | — |
| `finished_at` | timestamptz | yes | — | — |
| `error_category` | text | yes | — | — |
| `error_message` | text | yes | — | — |
| `external_post_id` | text | yes | — | — |
| `created_at` | timestamptz | no | now | — |

Unique constraint:

```text
(publication_id, attempt_number)
```

There is no `updated_at`.

---

### 5.27 `publication_reconciliations`

Purpose: durable investigation of uncertain external publication outcomes.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `publication_id` | uuid | no | — | FK → `publications.id` ON DELETE CASCADE |
| `attempt_id` | uuid | yes | — | FK → `publication_attempts.id` ON DELETE SET NULL |
| `status` | text | no | — | domain-validated |
| `checked_at` | timestamptz | yes | — | — |
| `external_post_id` | text | yes | — | — |
| `result` | text | yes | — | — |
| `details` | jsonb | yes | — | — |
| `created_at` | timestamptz | no | now | — |

Reconciliation outcomes include:

```text
PUBLISHED
RETRY_ELIGIBLE
```

There is no `updated_at`. Reconciliation records are append-oriented.

---

### 5.28 `system_config`

Purpose: database-backed runtime configuration.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `key` | text | no | — | PK |
| `value` | jsonb | no | — | — |
| `updated_by` | uuid | yes | — | FK → `users.id` ON DELETE SET NULL |
| `updated_at` | timestamptz | no | now | — |

The primary key is the configuration key itself (text), not a surrogate UUID. Examples include publication enablement, provider versions, and feature flags.

---

### 5.29 `config_audit_log`

Purpose: append-only history of configuration changes.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `key` | text | no | — | — |
| `old_value` | jsonb | yes | — | — |
| `new_value` | jsonb | yes | — | — |
| `user_id` | uuid | yes | — | FK → `users.id` ON DELETE SET NULL |
| `reason` | text | yes | — | — |
| `ip_address` | inet | yes | — | — |
| `created_at` | timestamptz | no | now | — |

Records are append-only.

---

### 5.30 `ai_usage`

Purpose: durable accounting of AI processing usage.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `content_id` | uuid | yes | — | FK → `content_items.id` ON DELETE SET NULL |
| `provider` | text | no | — | — |
| `model` | text | no | — | — |
| `operation` | text | no | — | — |
| `input_tokens` | integer | no | 0 | `>= 0` |
| `output_tokens` | integer | no | 0 | `>= 0` |
| `estimated_cost` | numeric(12,6) | no | 0 | `>= 0` |
| `created_at` | timestamptz | no | now | — |

The cost currency or unit remains an application-level decision (deferred decision D-006).

There is no `updated_at`.

---

### 5.31 `system_logs`

Purpose: optionally persisted structured operational and application logs.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `level` | text | no | — | — |
| `event` | text | no | — | — |
| `message` | text | yes | — | — |
| `trace_id` | uuid | yes | — | — |
| `content_id` | uuid | yes | — | FK → `content_items.id` ON DELETE SET NULL |
| `story_id` | uuid | yes | — | FK → `stories.id` ON DELETE SET NULL |
| `source_id` | uuid | yes | — | FK → `sources.id` ON DELETE SET NULL |
| `job_id` | text | yes | — | external/transient job correlation only |
| `publication_id` | uuid | yes | — | FK → `publications.id` ON DELETE SET NULL |
| `metadata` | jsonb | yes | — | — |
| `created_at` | timestamptz | no | now | — |

Runtime logging does not require every log line to be persisted in PostgreSQL.

`job_id` is a correlation reference only. It does not make worker execution state authoritative in PostgreSQL.

---

### 5.32 `notifications`

Purpose: durable operational notifications.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `type` | text | no | — | domain-validated |
| `severity` | text | no | — | domain-validated |
| `title` | text | no | — | — |
| `message` | text | no | — | — |
| `source_id` | uuid | yes | — | FK → `sources.id` ON DELETE SET NULL |
| `content_id` | uuid | yes | — | FK → `content_items.id` ON DELETE SET NULL |
| `publication_id` | uuid | yes | — | FK → `publications.id` ON DELETE SET NULL |
| `is_read` | boolean | no | false | — |
| `created_at` | timestamptz | no | now | — |
| `read_at` | timestamptz | yes | — | — |

Notification types must cover at least:

```text
credential failure
system failure
queue backlog
publication failure
AI budget threshold
source failure
```

The `type` and `severity` vocabularies are domain-validated and remain text values in DB v1.

---

### 5.33 `audit_logs`

Purpose: append-only cross-domain audit trail for important application and administrative events that do not already have a dedicated structured history table.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `actor_user_id` | uuid | yes | — | FK → `users.id` ON DELETE SET NULL |
| `action` | text | no | — | domain-validated |
| `entity_type` | text | no | — | domain-validated |
| `entity_id` | uuid | yes | — | polymorphic entity identifier |
| `changes` | jsonb | yes | — | — |
| `metadata` | jsonb | yes | — | — |
| `created_at` | timestamptz | no | now | — |

`actor_user_id` is nullable for system-generated events.

`entity_id` is intentionally not a polymorphic foreign key because one PostgreSQL column cannot safely reference multiple entity tables. The pair `(entity_type, entity_id)` is application-validated.

The table is append-only at application level. Corrections are represented by new audit events rather than updates or deletes.

`audit_logs` supplements dedicated business-history structures such as `config_audit_log`, `moderation_actions`, `publication_attempts`, `publication_reconciliations`, `webhook_deliveries`, and `interaction_response_attempts`. It does not replace them.

---

### 5.34 `webhook_subscriptions` — NEW in v1.1

Purpose: technical subscription configuration for an inbound webhook from an external provider to a specific destination.

A `webhook_subscriptions` row represents a concrete technical subscription belonging to a `destinations` row. It is the inbound analogue of `source_endpoints`: a destination may own multiple subscriptions, and each subscription carries its own verification secret and lifecycle.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `destination_id` | uuid | no | — | FK → `destinations.id` ON DELETE CASCADE |
| `provider` | varchar(32) | no | — | e.g. `META` |
| `fields` | text[] | no | — | non-empty array |
| `verify_token_encrypted` | text | no | — | `v1:base64(iv ‖ ct ‖ tag)` |
| `verify_token_key_version` | integer | no | — | `> 0` |
| `status` | varchar(32) | no | — | `ACTIVE`, `PAUSED`, `DISABLED` |
| `last_verified_at` | timestamptz | yes | — | — |
| `last_rotated_at` | timestamptz | yes | — | — |
| `created_at` | timestamptz | no | now | — |
| `updated_at` | timestamptz | no | now | — |

Unique constraint:

```text
(destination_id, provider)
```

Invariants:

- `fields` is a non-empty array; each element is validated against the domain vocabulary (`feed`, `mention`, and future values).
- `verify_token_encrypted` is never decrypted outside the ingress handler.
- The verify token is encrypted with `WEBHOOK_TOKEN_ENCRYPTION_KEY`, which is distinct from `META_CREDENTIAL_ENCRYPTION_KEY`.

Lifecycle:

```text
ACTIVE
PAUSED
DISABLED
```

The `hub.challenge` handshake updates `last_verified_at` only. Verify token rotation is a manual administrative operation and must produce an `audit_logs` entry.

Operational health for this subscription is persisted in `webhook_subscription_health` (§5.44). The `last_verified_at` column on this table records a configuration lifecycle event (successful `hub.challenge` handshake); it is distinct from `webhook_subscription_health.last_success_at`, which records a successfully processed inbound delivery.

**Multi-page scope note.** In v1.2, the App-level verify token is duplicated per subscription. This is a known limitation of the current aggregate boundary. The `webhook_endpoints` table and the accompanying refactor are deferred to v1.3 (see D-013).

---

### 5.35 `webhook_events` — NEW in v1.1

Purpose: immutable receipt of a single inbound HTTP POST from an external webhook provider.

A `webhook_events` row corresponds to one HTTP transaction: one received body, one signature verification, one idempotency key. The envelope may contain multiple entries and multiple changes; those materialize into `external_interactions` during processing.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `provider` | varchar(32) | no | — | `META` |
| `destination_id` | uuid | yes | — | FK → `destinations.id` ON DELETE SET NULL |
| `object_type` | varchar(32) | no | — | e.g. `page` |
| `external_object_id` | text | no | — | Page ID from payload |
| `field` | varchar(64) | yes | — | top-level field if extractable |
| `idempotency_key` | text | no | — | UNIQUE |
| `raw_payload` | jsonb | no | — | immutable |
| `raw_body_hash` | varchar(128) | no | — | SHA-256 of raw HTTP body |
| `signature_verified` | boolean | no | — | always `true` under fail-closed ingress |
| `trace_id` | uuid | no | generated | propagated downstream |
| `status` | varchar(32) | no | `RECEIVED` | see §9 |
| `received_at` | timestamptz | no | now | — |
| `processed_at` | timestamptz | yes | — | — |
| `updated_at` | timestamptz | no | now | — |

Unique constraint:

```text
(idempotency_key)
```

Invariants:

- `raw_payload` and `raw_body_hash` are immutable after insert.
- `idempotency_key = sha256(provider || raw_body_hash)`.
- `signature_verified` must be `true`; rows with `false` are not permitted under fail-closed ingress and are rejected at the HTTP boundary.
- `status = 'PROCESSED'` → `processed_at IS NOT NULL`.

Lifecycle: see §9.2.

---

### 5.36 `webhook_deliveries` — NEW in v1.1

Purpose: durable history of processing attempts for a `webhook_events` row.

This table is the business-history table for webhook processing side effects. It is not a generic worker execution log and does not duplicate BullMQ retry metadata.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `webhook_event_id` | uuid | no | — | FK → `webhook_events.id` ON DELETE CASCADE |
| `attempt_number` | integer | no | — | `> 0`, UNIQUE with event |
| `status` | varchar(32) | no | — | `PENDING`, `SUCCESS`, `RETRY`, `FAILED`, `DEAD_LETTER` |
| `started_at` | timestamptz | yes | — | — |
| `finished_at` | timestamptz | yes | — | — |
| `error_category` | varchar(64) | yes | — | canonical taxonomy |
| `error_message` | text | yes | — | — |
| `worker_id` | text | yes | — | diagnostic |
| `created_at` | timestamptz | no | now | — |

Unique constraint:

```text
(webhook_event_id, attempt_number)
```

Canonical `error_category` vocabulary:

```text
PAYLOAD_MALFORMED
UNSUPPORTED_FIELD
UNKNOWN_DESTINATION
UNKNOWN_PUBLICATION
PROCESSING_ERROR
EXTERNAL_API_ERROR
RATE_LIMIT
NETWORK_ERROR
UNKNOWN
```

`SIGNATURE_INVALID` is not a valid value here because signature verification fails closed at the HTTP ingress boundary and never produces a `webhook_events` row.

---

### 5.37 `external_interactions` — NEW in v1.1

Purpose: materialized inbound interaction derived from a `webhook_events` row.

This is the inbound domain's independent business entity. It carries its own identity and references content lifecycle entities only loosely and optionally.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `webhook_event_id` | uuid | yes | — | FK → `webhook_events.id` ON DELETE SET NULL |
| `destination_id` | uuid | yes | — | FK → `destinations.id` ON DELETE SET NULL |
| `publication_id` | uuid | yes | — | FK → `publications.id` ON DELETE SET NULL |
| `interaction_type` | varchar(32) | no | — | `COMMENT`, `REACTION`, `MENTION` |
| `external_interaction_id` | text | no | — | Meta-side identifier |
| `parent_external_id` | text | yes | — | reply target, if any |
| `actor_external_id` | text | yes | — | Meta user identifier |
| `actor_display_name` | text | yes | — | — |
| `content` | text | yes | — | comment text, if any |
| `permalink` | text | yes | — | — |
| `occurred_at` | timestamptz | no | — | provider event time |
| `raw_metadata` | jsonb | no | `{}` | — |
| `created_at` | timestamptz | no | now | — |
| `updated_at` | timestamptz | no | now | — |

Unique constraint:

```text
(interaction_type, external_interaction_id)
```

Invariants:

- The `(interaction_type, external_interaction_id)` pair is the natural external identity.
- `occurred_at` is monotonically advancing per interaction under concurrent updates; a stale event must not overwrite a fresher one.
- Soft deletion (`verb = "remove"`) is represented in `raw_metadata` and does not physically delete the row.

Foreign key behavior:

- `webhook_event_id`, `destination_id`, and `publication_id` are all `ON DELETE SET NULL`. The interaction outlives its originating event, destination, or publication.

The `publication_id` FK to `publications.id` is added by the deferred migration step (0009 in the current migration set) because the `publications` table is created after `external_interactions` in the dependency order. See §19.

---

### 5.38 `provider_credentials` — NEW in v1.1

Purpose: encrypted storage of provider authentication material with lifecycle tracking.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `scope` | varchar(32) | no | — | `APP`, `DESTINATION` |
| `destination_id` | uuid | yes | — | FK → `destinations.id` ON DELETE CASCADE |
| `provider` | varchar(32) | no | — | e.g. `META` |
| `credential_type` | varchar(64) | no | — | `APP_SECRET`, `PAGE_ACCESS_TOKEN` |
| `encrypted_value` | text | no | — | `v1:base64(iv ‖ ct ‖ tag)` |
| `encryption_key_version` | integer | no | — | `> 0` |
| `status` | varchar(32) | no | `UNKNOWN` | `VALID`, `EXPIRING`, `INVALID`, `UNKNOWN` |
| `expires_at` | timestamptz | yes | — | — |
| `last_validated_at` | timestamptz | yes | — | — |
| `last_rotation_at` | timestamptz | yes | — | — |
| `rotation_reason` | text | yes | — | — |
| `created_at` | timestamptz | no | now | — |
| `updated_at` | timestamptz | no | now | — |

Unique constraint:

```text
(
  provider,
  credential_type,
  scope,
  COALESCE(destination_id, '00000000-0000-0000-0000-000000000000'::uuid)
)
```

Invariants:

- `scope = 'APP'` → `destination_id IS NULL`.
- `scope = 'DESTINATION'` → `destination_id IS NOT NULL`.
- `expires_at IS NULL` is permitted for credentials that do not expire (e.g. App Secret).
- The plaintext value is never logged, audited, cached beyond its in-memory operation lifetime, or persisted outside this table.

Encryption:

- Algorithm: AES-256-GCM.
- Key material supplied via environment variables (`META_CREDENTIAL_ENCRYPTION_KEYS`, `META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION`).
- Additional authenticated data (AAD) binds the ciphertext to `(provider, credential_type, destination_id)`.
- Key version is stored per row so that rotation does not require a full-table rewrite in a single transaction.

---

### 5.39 `interaction_responses` — NEW in v1.1

Purpose: durable intent to publish an outbound response to an `external_interactions` row.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `interaction_id` | uuid | no | — | FK → `external_interactions.id` ON DELETE CASCADE |
| `destination_id` | uuid | no | — | FK → `destinations.id` ON DELETE SET NULL |
| `template_id` | text | yes | — | reference into `system_config` |
| `template_version` | integer | no | 1 | `>= 1` |
| `body` | text | yes | — | final response text (may be set post-moderation) |
| `status` | varchar(32) | no | `DRAFT` | see §9.3 |
| `scheduled_at` | timestamptz | yes | — | — |
| `responded_at` | timestamptz | yes | — | — |
| `external_response_id` | text | yes | — | Meta-side identifier |
| `created_at` | timestamptz | no | now | — |
| `updated_at` | timestamptz | no | now | — |

Unique constraint:

```text
(interaction_id)
```

Invariants:

- One response per interaction in DB v1. Multi-response threads are a deferred decision (D-008).
- `status = 'RESPONDED'` → `external_response_id IS NOT NULL AND responded_at IS NOT NULL`.
- `status = 'SCHEDULED'` → `scheduled_at IS NOT NULL`.

---

### 5.40 `interaction_response_attempts` — NEW in v1.1

Purpose: durable history of outbound response execution.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `response_id` | uuid | no | — | FK → `interaction_responses.id` ON DELETE CASCADE |
| `attempt_number` | integer | no | — | `> 0`, UNIQUE with response |
| `status` | varchar(32) | no | — | `PENDING`, `SUCCESS`, `RETRY`, `FAILED`, `DEAD_LETTER`, `UNKNOWN` |
| `started_at` | timestamptz | yes | — | — |
| `finished_at` | timestamptz | yes | — | — |
| `error_category` | varchar(64) | yes | — | canonical taxonomy |
| `error_message` | text | yes | — | — |
| `external_response_id` | text | yes | — | — |
| `request_payload_hash` | varchar(128) | no | — | SHA-256 of outbound body |
| `created_at` | timestamptz | no | now | — |

Unique constraint:

```text
(response_id, attempt_number)
```

`request_payload_hash` enables deterministic reconciliation: two attempts with the same hash were the same logical request.

---

### 5.41 `interaction_moderation_actions` — NEW in v1.1

Purpose: durable moderation decision history for `interaction_responses`.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `response_id` | uuid | no | — | FK → `interaction_responses.id` ON DELETE CASCADE |
| `user_id` | uuid | no | — | FK → `users.id` ON DELETE RESTRICT |
| `action` | varchar(32) | no | — | `APPROVE`, `REJECT`, `EDIT`, `ESCALATE` |
| `reason` | text | yes | — | — |
| `previous_body` | text | yes | — | required when `action = 'EDIT'` |
| `created_at` | timestamptz | no | now | — |

This table is deliberately separate from `moderation_actions` because that table is scoped to `publication_candidates` (content lifecycle), whereas this table is scoped to inbound interactions.

`previous_body` is required by the application layer when `action = 'EDIT'`. DB v1 does not enforce this with a `CHECK` constraint; the validation is performed by the moderation service.

---

### 5.42 `interaction_response_reconciliations` — NEW in v1.1

Purpose: durable investigation of uncertain outbound response outcomes.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `response_id` | uuid | no | — | FK → `interaction_responses.id` ON DELETE CASCADE |
| `attempt_id` | uuid | yes | — | FK → `interaction_response_attempts.id` ON DELETE SET NULL |
| `status` | varchar(32) | no | — | `RESPONDED`, `RETRY_ELIGIBLE`, `UNKNOWN` |
| `checked_at` | timestamptz | yes | — | — |
| `external_response_id` | text | yes | — | — |
| `details` | jsonb | yes | — | — |
| `created_at` | timestamptz | no | now | — |

Reconciliation may proceed via two paths:

- **Push** — the platform's own response reappears as a `feed` webhook event and is matched to the response by `(destination_id, external_response_id)`.
- **Pull** — a scheduled worker queries the provider for the response state.

Push is preferred because it is a natural consequence of the two-way integration. Pull is a bounded fallback.

---

### 5.43 `outbox_jobs` — NEW in v1.1

Purpose: unified transactional outbox for every durable domain transition that must produce an asynchronous side effect.

This table is a **platform primitive**. It is used by the webhook ingress, publication scheduling, credential refresh, and any future subsystem that must enqueue work inside a PostgreSQL transaction.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `id` | uuid | no | generated | PK |
| `queue_name` | varchar(64) | no | — | BullMQ queue name |
| `job_id` | text | no | — | UNIQUE — BullMQ deduplication key |
| `payload` | jsonb | no | — | identifiers only (§21) |
| `status` | varchar(32) | no | `PENDING` | `PENDING`, `DISPATCHING`, `DISPATCHED`, `FAILED` |
| `attempts` | integer | no | 0 | `>= 0` |
| `last_attempt_at` | timestamptz | yes | — | — |
| `last_error` | text | yes | — | — |
| `dispatched_at` | timestamptz | yes | — | — |
| `trace_id` | uuid | yes | — | nullable correlation |
| `created_at` | timestamptz | no | now | — |

Unique constraint:

```text
(job_id)
```

Check constraints:

```sql
CHECK (status IN ('PENDING','DISPATCHING','DISPATCHED','FAILED'))
CHECK (attempts >= 0)
CHECK (
  (status = 'DISPATCHED' AND dispatched_at IS NOT NULL) OR
  (status <> 'DISPATCHED' AND dispatched_at IS NULL)
)
```

Invariants:

- `payload` contains identifiers only. It must never contain a full document, a raw payload, or a secret.
- `job_id` is deterministic and idempotent. Enqueuing the same logical event twice produces the same `job_id`.
- There is no foreign key from `outbox_jobs` to any domain entity. The `job_id` string is the sole correlation mechanism. This is deliberate: the outbox is generic and must not couple to any domain table's lifecycle.

Lifecycle: see §9.4.

---

### 5.44 `webhook_subscription_health` — NEW in v1.2

Purpose: operational health extension for a `webhook_subscriptions` row.

The table is a strict 1:1 extension of `webhook_subscriptions`. It mirrors the pattern established by `source_endpoint_health` in DB v1 core (§5.5) and preserves operational health history that cannot be reconstructed later from `audit_logs` or `system_logs`.

| Column | Type | Null | Default | Constraint |
|---|---|---:|---|---|
| `subscription_id` | uuid | no | — | PK, FK → `webhook_subscriptions.id` ON DELETE CASCADE |
| `consecutive_failures` | integer | no | 0 | `>= 0` |
| `consecutive_successes` | integer | no | 0 | `>= 0` |
| `last_success_at` | timestamptz | yes | — | — |
| `last_failure_at` | timestamptz | yes | — | — |
| `last_error_category` | varchar(64) | yes | — | canonical taxonomy from §5.36 |
| `last_error_message` | text | yes | — | — |
| `events_today` | integer | no | 0 | `>= 0` |
| `updated_at` | timestamptz | no | now | — |

Invariants:

- `consecutive_failures >= 0` and `consecutive_successes >= 0`.
- `events_today >= 0`.
- The health record is created automatically when its owning subscription is created. It is not optional.

Relationship to `webhook_subscriptions`:

The health record is deleted with its owning subscription when that subscription is intentionally deleted. The 1:1 cardinality is enforced by the primary key being a foreign key to `webhook_subscriptions.id`.

Separation of concerns:

- `webhook_subscriptions.last_verified_at` remains on the subscription because it records a **configuration lifecycle event** (a successful `hub.challenge` handshake during subscription onboarding or re-verification).
- `webhook_subscription_health.last_success_at` records an **operational event** (a successfully processed inbound webhook delivery).
- `webhook_subscriptions.last_rotated_at` remains on the subscription because it records a **configuration lifecycle event** (verify token rotation).
- These timestamps are not interchangeable and must not be unified.

Health is intentionally separated from subscription configuration so that high-frequency operational updates do not require rewriting relatively stable configuration data. This mirrors the DB v1 core principle of separating operational health from configuration, as established for `source_endpoints` / `source_endpoint_health` (see §3.7 for the architectural rationale, §5.5 for the concrete table pattern).

Scope: **storage now, use later**. The table is part of DB v1.2. Health metrics consumption (alerting thresholds, auto-pause policy, dashboards, reputation-style decay) is a separate concern and remains deferred (D-009).

---

## 6. Referential Integrity

The canonical ingestion relationship graph from v1.0 is preserved unchanged:

```text
sources
  └── source_endpoints
        ├── source_endpoint_health
        └── discovery_observations
              └── discovered_resources
                    └── raw_resources
                          └── source_items
                                └── content_items
                                      ├── content_versions
                                      ├── content_urls
                                      ├── content_entities
                                      ├── content_categories
                                      ├── content_fingerprints
                                      ├── duplicate_matches
                                      └── story_members
                                            └── stories
```

### 6.1 v1.1 and v1.2 additions

```text
destinations
  ├── webhook_subscriptions
  │     └── webhook_subscription_health
  ├── webhook_events
  ├── provider_credentials
  ├── external_interactions
  └── interaction_responses

webhook_events
  ├── webhook_deliveries
  └── external_interactions (nullable, SET NULL)

external_interactions
  └── interaction_responses

interaction_responses
  ├── interaction_response_attempts
  ├── interaction_moderation_actions
  └── interaction_response_reconciliations

publications
  └── external_interactions (nullable, SET NULL)

users
  └── interaction_moderation_actions

outbox_jobs
  (no foreign keys — deliberate)
```

### 6.2 Source derivation rule

Unchanged from v1.0. `discovery_observations` stores only `endpoint_id`; the Source is derived through `source_endpoints.source_id`.

### 6.3 Provenance references

Unchanged from v1.0. `provenance_events.endpoint_id` uses `ON DELETE SET NULL`.

### 6.4 Outbox isolation

`outbox_jobs` intentionally holds no foreign keys. This prevents the outbox from participating in cascade deletion and prevents the outbox lifecycle from being coupled to any domain entity's lifecycle. Cleanup is time-based (§8.5), not reference-based.

---

## 7. Delete Behavior

DB v1 follows ownership-oriented deletion for operational and intermediate artifacts and durability-oriented retention for business history.

### 7.1 Cascade-appropriate relationships (v1.0)

```text
sources → source_endpoints
source_endpoints → source_endpoint_health
discovered_resources → discovery_observations
discovered_resources → raw_resources
content_items → content_urls
content_items → content_versions
content_items → content_entities
content_items → content_categories
content_items → content_fingerprints
content_items → duplicate_matches
content_items → story_members
stories → story_members
images → image_rights
```

### 7.2 Cascade-appropriate relationships (v1.1, new)

```text
destinations → webhook_subscriptions
destinations → provider_credentials
webhook_subscriptions → webhook_subscription_health
webhook_events → webhook_deliveries
external_interactions → interaction_responses
interaction_responses → interaction_response_attempts
interaction_responses → interaction_moderation_actions
interaction_responses → interaction_response_reconciliations
```

### 7.3 Set-null-appropriate relationships (v1.1, new)

```text
destinations → webhook_events
destinations → external_interactions
destinations → interaction_responses
publications → external_interactions
webhook_events → external_interactions
interaction_response_attempts → interaction_response_reconciliations
```

These preserve the external fact even when the referencing platform entity is intentionally removed.

### 7.4 Restrict-appropriate relationships (v1.1, new)

```text
publication_candidates → publications
destinations → publications
users → moderation_actions
users → interaction_moderation_actions
```

`RESTRICT` prevents accidental deletion of a business-history-referenced entity. The publication history, moderation history, and credential audit trail are not silently removed.

### 7.5 Durable-history relationships

Unchanged from v1.0. `publication_attempts`, `publication_reconciliations`, `config_audit_log`, and `audit_logs` are retained as durable history. In v1.1, `webhook_deliveries`, `interaction_response_attempts`, and `interaction_response_reconciliations` join this set.

### 7.6 Outbox cleanup

`outbox_jobs` uses time-based cleanup, not cascade:

```sql
DELETE FROM outbox_jobs
WHERE status = 'DISPATCHED'
  AND dispatched_at < now() - interval '7 days';
```

`PENDING`, `DISPATCHING`, and `FAILED` rows are never deleted by the cleanup job. `FAILED` rows require manual resolution or an operator-initiated purge.

---

## 8. Required Indexes and Uniqueness

### 8.1 v1.0 indexes (unchanged)

All indexes from v1.0 §8 remain required exactly as specified.

### 8.2 Webhook persistence indexes (v1.1)

```text
webhook_subscriptions(destination_id, provider) UNIQUE
webhook_subscriptions(status)

webhook_events(idempotency_key) UNIQUE
webhook_events(status, received_at)
webhook_events(destination_id, received_at DESC)
webhook_events(field, received_at DESC)
webhook_events(trace_id)

webhook_deliveries(webhook_event_id, attempt_number) UNIQUE
webhook_deliveries(status)

external_interactions(interaction_type, external_interaction_id) UNIQUE
external_interactions(publication_id, occurred_at DESC)
external_interactions(destination_id, occurred_at DESC)
external_interactions(interaction_type, occurred_at DESC)
```

### 8.3 Credential indexes (v1.1)

```text
provider_credentials unique index on
  (provider, credential_type, scope,
   COALESCE(destination_id, '00000000-0000-0000-0000-000000000000'::uuid))

provider_credentials(status)
provider_credentials(expires_at)
```

### 8.4 Interaction response indexes (v1.1)

```text
interaction_responses(interaction_id) UNIQUE
interaction_responses(status, scheduled_at)
interaction_responses(destination_id, status)
interaction_responses(external_response_id)

interaction_response_attempts(response_id, attempt_number) UNIQUE
interaction_response_attempts(status)

interaction_moderation_actions(response_id, created_at DESC)
interaction_moderation_actions(user_id, created_at DESC)

interaction_response_reconciliations(response_id)
interaction_response_reconciliations(status)
```

### 8.5 Outbox indexes (v1.1)

```text
outbox_jobs(job_id) UNIQUE

outbox_jobs(status, created_at)
WHERE status IN ('PENDING', 'DISPATCHING')
```

The partial index deliberately covers both `PENDING` and `DISPATCHING` rows because the dispatcher scans both. `DISPATCHED` rows are excluded to keep the index small over time.

### 8.6 Hot-path publication lookup index (v1.2, new)

```text
publications(external_post_id) WHERE external_post_id IS NOT NULL
```

The webhook processing pipeline resolves inbound interactions to their originating publication through `publications.external_post_id`:

```sql
SELECT id FROM publications WHERE external_post_id = $1;
```

This lookup executes on the `webhook.process` hot path for every inbound comment, reaction, and mention. The partial index is required because:

- `external_post_id` is `NULL` until the external publication is confirmed; indexing `NULL` rows is wasteful.
- The lookup pattern is always `WHERE external_post_id = X AND X IS NOT NULL`.
- Without this index, the lookup degrades to a full table scan as the publications history grows.

No unique constraint is placed on `external_post_id`. The column represents a historical external identifier that may legitimately repeat if an external post is deleted and re-created by the provider.

### 8.7 Webhook subscription health indexes (v1.2, new)

```text
webhook_subscription_health(last_failure_at)
```

### 8.8 Index discipline

Additional indexes must not be added mechanically. Every index must correspond to a demonstrated query pattern or operational need.

---

## 9. Lifecycle Integrity

The database stores durable state. The domain/application layer owns legal lifecycle transitions.

### 9.1 Existing lifecycles (unchanged from v1.0)

Source lifecycle, endpoint lifecycle, content lifecycle, and publication lifecycle remain exactly as specified in v1.0 §9.

### 9.2 Webhook event lifecycle

Inbound webhook events transition through a strict, linear state machine from ingress to processing completion:

```text
RECEIVED → PROCESSING → PROCESSED
                 │
                 └──> FAILED

```

- **`RECEIVED`**: The HTTP POST request has passed signature verification, and the raw payload and headers have been durably committed to `webhook_events` alongside an enqueued outbox job.
- **`PROCESSING`**: A worker has claimed the event and is dispatching the payload to domain handlers (materializing interactions, triggering automations).
- **`PROCESSED`**: Domain materialization completed successfully. All resulting entities (`external_interactions`, outbox side effects) are committed.
- **`FAILED`**: The event processing exhausted all retry attempts or encountered an unrecoverable failure. The event enters a dead-letter state requiring manual operational review.

Re-processing an already `PROCESSED` event is structurally prevented by the immutable `idempotency_key` uniqueness constraint.

A `PROCESSING` row whose `updated_at` is older than `WEBHOOK_PROCESSING_TIMEOUT_SECONDS` is recoverable by `system.rebuild`. The recovery path returns the row to `RECEIVED` and re-enqueues the outbox job.

### 9.3 Interaction response lifecycle

Outbound responses to external interactions follow an explicit review and publishing workflow:

```text
DRAFT ──> MODERATION_REQUIRED ──> APPROVED ──> SCHEDULED ──> RESPONDED
  │               │                   │
  │               └──> REJECTED       └──> FAILED
  │
  └──> AUTO_RESPOND ──────────────────────────> RESPONDED

```

- **`DRAFT`**: The initial state when a response record is created.
- **`AUTO_RESPOND`**: Automated classification determined the response is safe for immediate dispatch without human review.
- **`MODERATION_REQUIRED`**: Sentiment, keyword filters, or policy rules flagged the response, holding it for human review in `interaction_moderation_actions`.
- **`APPROVED` / `REJECTED`**: Moderator decision outcomes. Approved responses move to scheduling or immediate dispatch.
- **`SCHEDULED`**: The response is waiting for its designated `scheduled_at` timestamp.
- **`RESPONDED`**: The external provider successfully accepted the outbound response, and `external_response_id` is populated.
- **`FAILED`**: Delivery attempts exhausted without success.

Terminal statuses: `RESPONDED`, `REJECTED`, `FAILED`.

Editing an approved response (`EDIT` action in `interaction_moderation_actions`) returns the response to `MODERATION_REQUIRED` and requires re-validation before dispatch.

### 9.4 Outbox lifecycle

`outbox_jobs` manages the transactional transfer of work from PostgreSQL to the asynchronous BullMQ execution layer:

```text
PENDING ──> DISPATCHING ──> DISPATCHED
    │
    └──> FAILED

```

- **`PENDING`**: Committed within a business transaction, waiting to be picked up by the outbox dispatcher poller.
- **`DISPATCHING`**: Claimed by the active dispatcher thread to be published into the designated Redis/BullMQ queue.
- **`DISPATCHED`**: Successfully enqueued into BullMQ. The job ID is handed off, and the side effect is now managed by the worker runtime.
- **`FAILED`**: Dispatch failed due to infrastructure errors or broker unavailability, requiring operator intervention or automated sweep retry.

A `DISPATCHING` row whose `last_attempt_at` is older than `OUTBOX_DISPATCH_STALE_THRESHOLD_SECONDS` is recoverable. Recovery sets it back to `PENDING` and allows re-dispatch. BullMQ's `jobId` deduplication guarantees that a recovered row cannot produce a duplicate job.

Terminal statuses: `DISPATCHED`, `FAILED`.

### 9.5 Reconciliation invariants

Every state machine in v1.1 that has an external side effect must have a reconciliation path:

- `webhook_events` uses stale-`PROCESSING` recovery, not a reconciliation table, because processing is a local operation.
- `interaction_responses` uses `interaction_response_reconciliations` with both push and pull paths.
- `outbox_jobs` uses stale-`DISPATCHING` recovery, not a reconciliation table, because dispatch is an internal operation and is fully recoverable via BullMQ `jobId` deduplication.

---

## 10. Endpoint State Atomicity and Concurrency

The old source-level cursor model is removed from DB v1.

Endpoint-specific incremental state is persisted in:

```text
source_endpoints.state
source_endpoints.state_version
```

A worker must preserve the state version it observed when it started processing an endpoint.

A state update succeeds only when:

```text
persisted.state_version == observed.state_version
```

The successful update must atomically:

1. write the new endpoint state;
2. increment `state_version`;
3. update `updated_at`.

If the optimistic-lock condition fails, the worker must not overwrite a newer endpoint state.

Pipeline persistence that depends on accepted discovery results should be performed in a PostgreSQL transaction so that durable artifact persistence and endpoint state advancement remain consistent.

---

## 11. Daily Source/Endpoint Limits

The source `safety_limits` configuration may contain limits such as:

```text
maxItemsPerDay
maxItemsPerPoll
requestTimeoutMs
maxResponseSizeBytes
maxRequestsPerMinute
```

DB v1 requires concurrency-safe durable enforcement of `maxItemsPerDay`.

The operational counter is stored in:

```text
source_endpoint_health.items_today
```

because the new ingestion architecture applies execution and discovery limits at the technical endpoint boundary.

The application/transaction layer is responsible for atomic counter updates and for defining the reset semantics for a new calendar day.

---

## 12. Transactional Outbox Boundary

### 12.1 Principle

Every durable domain transition that must produce an asynchronous side effect enqueues its job through `outbox_jobs` inside the same PostgreSQL transaction that commits the domain state.

```text
BEGIN
  <domain state mutation>
  INSERT INTO outbox_jobs (queue_name, job_id, payload, trace_id)
COMMIT
```

A separate in-process component, the `OutboxDispatcher`, reads `PENDING` rows and dispatches them to BullMQ.

### 12.2 Rationale

PostgreSQL and Redis are independent systems. No transactional client spans both. Attempting to enqueue directly inside the PostgreSQL transaction produces an unrecoverable split-brain:

```text
COMMIT succeeds, Redis add fails  → orphaned event in DB, never processed
COMMIT fails, Redis add succeeds  → orphaned job in queue, worker crashes on load
```

The outbox pattern removes this class of failure by making the enqueue intent durable in the same system that owns the domain state. Redis becomes a derived cache, not a coordination point.

### 12.3 Ingress transaction boundary

The Meta webhook ingress enforces exactly one transaction boundary:

```text
1. Verify signature (fail-closed → 401)
2. Validate envelope with Zod (fail-closed → 400)
3. BEGIN
     INSERT INTO webhook_events (...)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id
     IF inserted:
       INSERT INTO outbox_jobs (
         queue_name = 'webhook.process',
         job_id     = 'webhook.process:' || event.id,
         payload    = jsonb_build_object('webhookEventId', event.id),
         trace_id   = event.trace_id
       )
   COMMIT
4. HTTP 200 OK
```

No Redis call occurs on the HTTP hot path. Redis unavailability cannot block ingress, cannot produce orphaned events, and cannot produce orphaned jobs.

### 12.4 Dispatcher claim semantics

The dispatcher claims work using `FOR UPDATE SKIP LOCKED`:

```sql
WITH claimed AS (
  SELECT id
  FROM outbox_jobs
  WHERE status = 'PENDING'
  ORDER BY created_at
  LIMIT $1
  FOR UPDATE SKIP LOCKED
)
UPDATE outbox_jobs
SET status = 'DISPATCHING',
    last_attempt_at = now(),
    attempts = attempts + 1
WHERE id IN (SELECT id FROM claimed)
RETURNING *;
```

This allows multiple dispatcher instances to operate concurrently without coordination. `SKIP LOCKED` guarantees no two dispatchers claim the same row.

### 12.5 Dispatch and recovery

After claiming, the dispatcher calls BullMQ and then marks the row `DISPATCHED`. If the dispatcher crashes between the BullMQ add and the `DISPATCHED` update, the row remains `DISPATCHING`. Recovery restores it to `PENDING` after `OUTBOX_DISPATCH_STALE_THRESHOLD_SECONDS`.

Recovery is safe because BullMQ's `jobId` option deduplicates the re-enqueue. A recovered row produces the same `job_id` and therefore no duplicate job.

### 12.6 Rebuild integration

`system.rebuild` performs two distinct responsibilities:

1. **Outbox dispatch recovery** — restores stale `DISPATCHING` rows to `PENDING` and triggers a dispatch cycle.
2. **Domain-state rebuild** — derives missing work from durable domain state (e.g. `webhook_events.status = 'RECEIVED'` without a corresponding outbox row after cleanup, `publications.status = 'SCHEDULED'`).

Both responsibilities are idempotent. Running `system.rebuild` twice must not produce duplicate publications, duplicate responses, or duplicate webhook processing.

### 12.7 Cleanup

A dedicated `system.outbox.cleanup` job deletes `DISPATCHED` rows older than `OUTBOX_CLEANUP_RETENTION_DAYS`. Cleanup is independent from `system.rebuild` and runs on its own cron schedule.

`PENDING`, `DISPATCHING`, and `FAILED` rows are never deleted by cleanup.

---

## 13. Worker Execution and Operational Observability

DB v1 does not persist every worker execution attempt as a canonical database entity.

Transient queue state, retry metadata, execution timing, and worker-level diagnostic information are owned by the Redis/BullMQ execution layer.

PostgreSQL remains authoritative for:

```text
durable pipeline state
canonical artifacts
provenance
endpoint health
webhook subscription health
business history
audit history
outbox intent
```

The v1.1 additions do not introduce a worker execution history table. `webhook_deliveries`, `interaction_response_attempts`, and `interaction_response_reconciliations` are business-history tables for external side effects, not generic worker execution logs.

`system_logs` may persist selected structured operational records, but it is not a mirror of BullMQ job state. `job_id` in `system_logs` is a correlation identifier only.

A future `EndpointRun` or equivalent execution-history entity may be introduced if operational requirements justify persistent execution analytics, historical run metrics, SLA analysis, or long-term diagnostics.

Such an entity must not become a duplicate representation of Redis/BullMQ queue state.

---

## 14. Provenance and Lineage Integrity

Provenance is immutable and cross-cutting.

The database records lineage through:

```text
provenance_events
```

Each event identifies:

```text
target_entity_type
target_entity_id
endpoint_id
phase
method
artifact_hash
observed_at
```

Phases are:

```text
DISCOVERY
ACQUISITION
EXTRACTION
```

The `method` value must be compatible with the phase according to the domain contract.

The provenance target is intentionally polymorphic because a single lineage mechanism spans:

```text
DISCOVERED_RESOURCE
RAW_RESOURCE
SOURCE_ITEM
CONTENT_ITEM
CONTENT_VERSION
```

Provenance events are never updated as part of normal pipeline processing.

---

## 15. Discovery Identity and Multi-Path Discovery

`discovered_resources.canonical_url` is the canonical candidate identity and is unique.

Individual detection events are stored in:

```text
discovery_observations
```

Therefore:

```text
RSS endpoint ─────┐
Sitemap endpoint ─┼→ same discovered_resources row
HTML endpoint ────┘
```

The model intentionally separates:

```text
candidate identity
        ≠
observation event
```

This allows the platform to preserve complete multi-path discovery history without creating duplicate candidate identities for every endpoint.

---

## 16. Canonical Content Identity

The canonical content layer is independent from source and discovery identity.

The identity chain is:

```text
Source
  ↓
SourceEndpoint
  ↓
DiscoveryObservation
  ↓
DiscoveredResource
  ↓
RawResource
  ↓
SourceItem
  ↓
ContentItem
```

A SourceItem may map to a ContentItem only after normalization.

A ContentItem is identified by its canonical URL at the canonical content layer.

Alternate URLs are stored separately in `content_urls`.

Fingerprints are independent of URL identity and are used for duplicate detection.

---

## 17. Deduplication and Clustering Persistence

### Deduplication

`content_fingerprints` stores algorithm-specific structural fingerprints.

`duplicate_matches` stores the evidence produced by duplicate detection.

These are intentionally separate responsibilities:

```text
Fingerprint
    ↓
candidate match detection
    ↓
DuplicateMatch evidence
    ↓
canonical identity decision
```

The database does not treat a fingerprint match as automatic canonicalization.

### Clustering

`stories` represents thematic grouping.

`story_members` represents membership evidence and assignment metadata.

```text
ContentItem N:M Story
```

Story membership is independent from Source identity and independent from duplicate identity.

---

## 18. Query Patterns

### 18.1 v1.0 patterns (unchanged)

All query patterns from v1.0 §17 remain supported exactly as specified.

### 18.2 v1.1 patterns (new)

#### Webhook ingress deduplication

```sql
INSERT INTO webhook_events (idempotency_key, ...)
VALUES (...)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id;
```

#### Pending webhook dispatch

```sql
SELECT * FROM outbox_jobs
WHERE status = 'PENDING'
ORDER BY created_at
LIMIT $1
FOR UPDATE SKIP LOCKED;
```

#### Stale webhook processing recovery

```sql
SELECT id FROM webhook_events
WHERE status IN ('RECEIVED', 'FAILED')
   OR (status = 'PROCESSING' AND updated_at < now() - interval '5 minutes');
```

#### Interaction lookup by external identity

```sql
SELECT * FROM external_interactions
WHERE interaction_type = $1 AND external_interaction_id = $2;
```

#### Response reconciliation candidates

```sql
SELECT id FROM interaction_responses
WHERE status = 'UNKNOWN'
   OR (status = 'SCHEDULED' AND scheduled_at < now() - interval '5 minutes');
```

#### Credential expiry scan

```sql
SELECT * FROM provider_credentials
WHERE credential_type = 'PAGE_ACCESS_TOKEN'
  AND expires_at < now() + interval '7 days'
  AND status IN ('VALID', 'EXPIRING');
```

#### Credential health for a destination

```sql
SELECT * FROM provider_credentials
WHERE scope = 'DESTINATION' AND destination_id = $1;
```

### 18.3 v1.2 patterns (new)

#### Publication lookup by external post ID

```sql
SELECT id FROM publications WHERE external_post_id = $1;
```

Served by the partial index `publications_external_post_id_idx`.

#### Webhook subscription health lookup

```sql
SELECT * FROM webhook_subscription_health
WHERE subscription_id = $1;
```

#### Subscription health recovery scan

```sql
SELECT subscription_id FROM webhook_subscription_health
WHERE last_failure_at > last_success_at
   OR last_success_at IS NULL;
```

---

## 19. Migration Dependency Order

The initial DB v1 migration must create objects in dependency order.

Recommended order:

```text
 1. extensions (pgcrypto)
 2. roles
 3. users
 4. destinations
 5. sources
 6. source_endpoints
 7. source_endpoint_health
 8. discovered_resources
 9. discovery_observations
10. provenance_events
11. raw_resources
12. stories
13. content_items
14. content_versions
15. source_items
16. content_entities
17. content_categories
18. content_fingerprints
19. duplicate_matches
20. content_urls
21. story_members
22. images
23. image_rights
24. publication_candidates
25. moderation_actions
26. publications
27. publication_attempts
28. publication_reconciliations
29. system_config
30. config_audit_log
31. ai_usage
32. system_logs
33. notifications
34. audit_logs
35. (deferred) content_items.current_version_id FK
36. webhook_subscriptions
37. webhook_events
38. webhook_deliveries
39. external_interactions
40. provider_credentials
41. interaction_responses
42. interaction_response_attempts
43. interaction_moderation_actions
44. interaction_response_reconciliations
45. outbox_jobs
46. webhook_subscription_health
```

The apparent count above includes the extension step and the deferred FK step and therefore does not represent a table count. The DB v1 persistence table count is **44 tables**.

`webhook_subscription_health` is created after `webhook_subscriptions` (step 36) and may be created at any later point in the dependency chain. It is placed last to keep the v1.1 sequence numerically intact for auditing purposes.

`outbox_jobs` holds no foreign keys. This is deliberate: the outbox is a platform primitive whose lifecycle must not be coupled to any domain entity.

No `source_cursors` or `source_health` table is created.

---

## 20. Migration Strategy

Production schema changes strictly follow the zero-downtime four-phase protocol:

1. **EXPAND**: Add new tables, columns, or constraints in a backward-compatible manner. Existing application code continues to run unchanged.
2. **MIGRATE**: Deploy application code that writes to both old and new structures (or reads from the expanded schema safely). Backfill historical data where necessary.
3. **SWITCH**: Switch read and write operations entirely to the new schema elements. Deprecate legacy paths.
4. **CONTRACT**: Remove obsolete columns, tables, or constraints once verification confirms no residual dependency.

No breaking column renames or type transformations may occur in a single atomic migration. All modifications to the v1.2 database layer must adhere to these safety invariants.

For the clean DB v1 baseline, the initial migration must create:

- required PostgreSQL extensions (`pgcrypto`);
- all 44 tables in dependency order;
- foreign keys;
- check constraints;
- unique constraints;
- indexes;
- required initial defaults.

The migration must not silently introduce tables or provider-specific persistence structures outside this contract.

Because the existing repository migration files are empty placeholders rather than a deployed historical schema, DB v1 may be established as a clean baseline rather than as a compatibility migration from a populated legacy schema.

### 20.1 Drizzle migration chain

The 44-table schema is materialized through a chain of additive migrations. The current migration set is:

```text
0000 — foundation:    pgcrypto, roles, users, destinations
0001 — outbox:        outbox_jobs
0002 — webhook:       webhook_subscriptions, webhook_subscription_health,
                      webhook_events, webhook_deliveries,
                      external_interactions
0003 — ingestion A:   sources, source_endpoints, source_endpoint_health
0004 — ingestion B:   discovered_resources, discovery_observations,
                      provenance_events, raw_resources
0005 — content A:     stories, content_items, content_versions, source_items
0006 — content B:     content_entities, content_categories,
                      content_fingerprints, duplicate_matches,
                      content_urls, story_members
0007 — media:         images, image_rights
0008 — publication:   publication_candidates, moderation_actions,
                      publications, publication_attempts,
                      publication_reconciliations
0009 — deferred FK:   external_interactions.publication_id → publications.id
0010 — credential:    provider_credentials
0011 — interaction:   interaction_responses, interaction_response_attempts,
                      interaction_moderation_actions,
                      interaction_response_reconciliations
0012 — config:        system_config, config_audit_log
0013 — observability: ai_usage, system_logs, notifications, audit_logs
```

The `pgcrypto` extension is created in `0000` and is never re-declared.

---

## 21. Explicit Non-Goals

The following are outside the DB v1 persistence contract unless separately specified:

- publisher-specific HTML extraction schemas;
- crawler implementation details;
- HTTP client implementation;
- headless browser implementation;
- Redis/BullMQ internals;
- worker retry internals;
- generic worker execution history;
- AI model implementation;
- embedding engine implementation;
- publication adapter implementation;
- scheduling policy implementation;
- provider-specific credential storage beyond `provider_credentials`;
- authentication session/token persistence;
- final image status taxonomy;
- final image-rights taxonomy;
- canonical entity taxonomy;
- canonical category taxonomy;
- AI cost currency/unit.

### Additional non-goals introduced by v1.1

- Messenger (`messages`) webhook handling.
- Message threads on a single interaction (one response per interaction in DB v1).
- AI-generated response text (templates are deterministic in DB v1).
- Multi-provider webhook support beyond Meta (the schema is provider-agnostic where practical, but only Meta is in scope).
- Persistent webhook subscription health aggregation beyond `last_verified_at`.

### Additional non-goals introduced by v1.2

- App-level webhook configuration aggregate (`webhook_endpoints`) — deferred to v1.3 (D-013).
- Provider-aware natural key for `external_interactions` — deferred to v1.3 (D-016).
- Analytics read models for Meta-specific aggregations — deferred beyond v1.3.

These concerns may receive additional persistence structures in later architecture revisions, but they must not be silently added to DB v1.

---

## 22. Validation Requirements

### 22.1 v1.0 validation requirements (unchanged)

All structural, source, pipeline, integrity, infrastructure boundary, and migration validation requirements from v1.0 §21 remain in force.

### 22.2 v1.1 additions — structural validation

- All 10 new tables are represented.
- All new foreign keys have existing targets and correct directions.
- The `outbox_jobs` table has no foreign keys.
- Every new unique business identity is expressed as a `UNIQUE` constraint.
- Every new index corresponds to a documented query pattern.
- The `webhook_events` `CHECK` constraints on status and the `outbox_jobs` `CHECK` constraints on status and `dispatched_at` consistency are present.
- The `provider_credentials` partial unique index using `COALESCE` is present.

### 22.3 v1.1 additions — webhook validation

- `webhook_events.idempotency_key` is unique.
- `webhook_events.raw_payload` and `raw_body_hash` are immutable after insert.
- `webhook_events.signature_verified` is always `true`.
- `external_interactions` has a unique `(interaction_type, external_interaction_id)` constraint.
- `external_interactions.occurred_at` is monotonically advancing per interaction.
- `webhook_deliveries.attempt_number` is unique per event and strictly positive.
- No table stores a plaintext secret.

### 22.4 v1.1 additions — credential validation

- `provider_credentials.encrypted_value` never contains a plaintext secret.
- `provider_credentials.encryption_key_version > 0` on every row.
- The `scope` and `destination_id` consistency invariant holds: `APP` rows have `NULL` destination; `DESTINATION` rows have a non-null destination.
- The partial unique index correctly deduplicates `APP` scope rows via `COALESCE`.

### 22.5 v1.1 additions — outbox validation

- `outbox_jobs.job_id` is unique.
- `outbox_jobs.payload` contains identifiers only.
- `outbox_jobs` has no foreign keys.
- `outbox_jobs` status and `dispatched_at` consistency is enforced by `CHECK`.
- The partial index on `(status, created_at)` covers both `PENDING` and `DISPATCHING`.
- Cleanup only deletes `DISPATCHED` rows.

### 22.6 v1.1 additions — idempotency validation

- Every retryable side effect has a deterministic `job_id`.
- Every inbound external event has an `idempotency_key`.
- Every materialized external entity has a natural external identifier with a `UNIQUE` constraint.
- The three-layer idempotency model is preserved: HTTP receipt → job ID → domain natural key.

### 22.7 v1.1 additions — migration validation

- The v1.1 migration does not modify any v1.0 table.
- The v1.1 migration adds exactly 10 tables and no others.
- Migration order is dependency-safe.
- Drizzle introspection matches this contract.
- Generated migrations do not introduce undocumented objects.
- Schema constraints match this document exactly.

### 22.8 v1.1 additions — transactional boundary validation

- The webhook ingress performs exactly one database transaction per HTTP request.
- No Redis call occurs on the webhook ingress hot path.
- Every durable domain transition that produces an asynchronous side effect enqueues through `outbox_jobs` inside the domain transaction.
- No direct BullMQ enqueue occurs outside the `OutboxDispatcher` for outbox-managed side effects.

### 22.9 v1.2 additions

- The `webhook_subscription_health` table is present and is a strict 1:1 extension of `webhook_subscriptions`.
- The `webhook_subscription_health` primary key is a foreign key to `webhook_subscriptions.id` with `ON DELETE CASCADE`.
- The `webhook_subscription_health` counters (`consecutive_failures`, `consecutive_successes`, `events_today`) are non-negative.
- The `publications.external_post_id` partial index is present with the `WHERE external_post_id IS NOT NULL` clause.
- No unique constraint is placed on `publications.external_post_id`.
- The `external_interactions` composite unique constraint remains `(interaction_type, external_interaction_id)`.
- No `external_interactions.provider` column is introduced in v1.2.
- No `webhook_endpoints` table is introduced in v1.2.

---

## 23. Architectural Invariants

The following invariants are normative for DB v1 and v1.2.

### 23.1 Carried forward from v1.0

1. A Source is a logical publisher or brand, not a technical endpoint.
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
19. PostgreSQL is authoritative for durable business and pipeline state.
20. Redis/BullMQ is authoritative only for transient execution state and queue mechanics.
21. Worker execution attempts are not canonical DB v1 entities.
22. The model remains compatible with RSS, Atom, Sitemap, HTML listing, API, and direct-seed discovery strategies.
23. Physical PostgreSQL details are derived from the logical model rather than redefining it.

### 23.2 Introduced by v1.1

24. Every durable domain transition that produces an asynchronous side effect enqueues through `outbox_jobs` inside the same PostgreSQL transaction.
25. No direct BullMQ enqueue is permitted on a durable-write hot path.
26. The Meta webhook ingress performs exactly one database transaction per HTTP request and no Redis call on the hot path.
27. `webhook_events.raw_payload` and `webhook_events.raw_body_hash` are immutable after receipt.
28. `webhook_events.signature_verified` is always `true`; signature verification fails closed at the HTTP boundary.
29. External interactions are materialized as their own domain entity and reference content lifecycle entities only via nullable foreign keys with `ON DELETE SET NULL`.
30. Provider credentials are encrypted at rest with application-managed keys, and no plaintext secret is persisted in any ordinary application table, log, audit record, or extended cache.
31. The verify token and the provider credential use distinct encryption keys.
32. Interaction responses have their own durable lifecycle, their own moderation history, and their own reconciliation history, separate from publications.
33. The `outbox_jobs` table has no foreign keys.
34. Reconciliation is mandatory for every state machine that has an external side effect.

### 23.3 Introduced by v1.2

35. Webhook subscription operational health is persisted separately from webhook subscription configuration, mirroring the separation established for `source_endpoints` / `source_endpoint_health` in DB v1 core.
36. The natural external identity of an `external_interactions` row is expressed as a composite of `interaction_type` and `external_interaction_id`. Provider-aware natural key evolution (adding a `provider` column and switching to `(provider, external_interaction_id)`) is deferred to v1.3 and must not be introduced incrementally.

---

## 24. Deferred Decisions

### D-001 — Authentication session/token persistence

`users` and `roles` are persisted, but session, refresh-token, credential-rotation, and external-identity persistence are not defined here.

**Status: DEFERRED — NON-BLOCKING**

### D-002 — Image status vocabulary

`images.status` remains domain-validated text.

**Status: DEFERRED — NON-BLOCKING**

### D-003 — Image rights taxonomy

`image_rights.rights_status` remains domain-validated text.

**Status: DEFERRED — NON-BLOCKING**

### D-004 — Entity taxonomy

`content_entities.entity_type` remains text.

**Status: DEFERRED — NON-BLOCKING**

### D-005 — Category taxonomy

`content_categories.category` remains text.

**Status: DEFERRED — NON-BLOCKING**

### D-006 — AI cost currency/unit

`ai_usage.estimated_cost` persists a numeric value, but the authoritative currency or accounting unit is defined outside this database contract.

**Status: DEFERRED — NON-BLOCKING**

### D-007 — Persistent endpoint execution history

A future `EndpointRun` or equivalent may be introduced if persistent operational analytics become necessary.

**Status: DEFERRED — NON-BLOCKING**

Such an entity must not duplicate Redis/BullMQ execution state.

### D-008 — Interaction threading

The `external_interactions.parent_external_id` column is present in DB v1 and is sufficient to record parent-child relationships between interactions. A full thread model (`conversation_threads`, `depth`, `reply_count`, thread-root materialization) is **not** required in DB v1.

A dedicated thread model becomes justified only when at least one of the following holds:

- the admin UI requires a tree-structured thread view;
- analytics measures thread depth, reply distribution, or engagement cascade;
- the automatic response policy requires thread context to make a decision.

Until then, the data required to reconstruct a thread is preserved via `parent_external_id` and `permalink`. Only the model is deferred, not the information.

**Status: DEFERRED — NON-BLOCKING (data preserved; model deferred)**

### D-009 — Webhook subscription health

The `webhook_subscription_health` table (§5.44) is part of DB v1.2. It provides durable operational health storage for webhook subscriptions, mirroring the `source_endpoint_health` pattern.

The **storage** is resolved in v1.2.

The **use** of this data — alerting thresholds, auto-pause on consecutive failures, health dashboards, decay-weighted reputation — is deferred.

**Status: RESOLVED IN v1.2 (storage) — USE DEFERRED — NON-BLOCKING**

### D-010 — Response template storage

DB v1.1 stores interaction response templates in `system_config` under the key `interaction_response_templates`. A dedicated `interaction_response_templates` table may be introduced if template count, versioning, or access control requirements grow beyond what `system_config` and `config_audit_log` provide.

**Status: DEFERRED — NON-BLOCKING**

### D-011 — Response rule storage

Interaction response policy rules are stored in `system_config` under the key `interaction_response_rules`. A dedicated table may be introduced if rule complexity justifies it.

**Status: DEFERRED — NON-BLOCKING**

### D-012 — AI-assisted response generation

DB v1.1 interaction responses are template-based and deterministic. AI-assisted response text generation is a post-MVP feature and is not represented in the schema.

**Status: DEFERRED — NON-BLOCKING**

### D-013 — Multi-provider vs multi-page webhook scope

Two distinct concerns are separated:

**Multi-page (within Meta).** Deferred to v1.3. A single Meta App that serves multiple Facebook Pages requires an App-level webhook configuration aggregate — specifically, a `webhook_endpoints` table that owns the App-level `verify_token`, and a refactored `webhook_subscriptions` that references the endpoint instead of duplicating the verify token per Page.

This is an **aggregate boundary** change, not a table addition. It affects the verification flow, the credential rotation flow, the admin configuration UI, the audit trail, the repository layer, the service layer, and the migration layer. It is therefore scheduled as an independent workstream (v1.3), not folded into the additive v1.2 changes.

**Multi-provider (beyond Meta).** Deferred beyond v1.3. The schema is provider-aware where practical (`webhook_subscriptions.provider`, `webhook_events.provider`, `provider_credentials.provider`), but the extraction logic, response policy, and credential validation are Meta-specific.

**Status: DEFERRED — NON-BLOCKING (multi-page → v1.3; multi-provider → v1.3+)**

### D-014 — Outbox payload schema versioning

`outbox_jobs.payload` is untyped `jsonb`. A future versioned payload envelope may be introduced if cross-version dispatch compatibility becomes necessary during rolling deployments.

**Status: DEFERRED — NON-BLOCKING**

### D-015 — Credential rotation history

`provider_credentials` tracks only the latest value and `last_rotation_at`. Historical credential values are not retained. A future `provider_credential_history` table may be introduced if forensic requirements justify it.

**Status: DEFERRED — NON-BLOCKING**

### D-016 — Provider-aware natural key for `external_interactions`

DB v1.2 uses `(interaction_type, external_interaction_id)` as the natural external identity of an `external_interactions` row. This composite constraint is preserved unchanged from v1.1.

The long-term natural key is expected to be `(provider, external_interaction_id)`, because:

- the rest of the schema is deliberately provider-aware (`webhook_events.provider`, `provider_credentials.provider`, `webhook_subscriptions.provider`);
- different providers may not guarantee global uniqueness of their external identifiers;
- the `interaction_type` axis does not model the provider boundary and would be insufficient if a non-Meta provider were added.

A provider-aware refactor is deferred to v1.3, where it will be performed together with the `webhook_endpoints` introduction and multi-page Meta support. The v1.3 migration will:

1. add a `provider` column to `external_interactions`;
2. backfill existing rows with `'META'`;
3. replace the composite `(interaction_type, external_interaction_id)` constraint with `(provider, external_interaction_id)`.

Introducing a narrower constraint (`UNIQUE (external_interaction_id)`) in v1.2 is explicitly rejected because it would:

- assume a Meta-specific global uniqueness guarantee that may not hold for future providers;
- create an asymmetry with the rest of the schema's provider-aware pattern;
- require a second migration in v1.3 to widen the constraint to `(provider, external_interaction_id)`.

The v1.2 scope is additive and constraint-tightening only in cases that do not touch domain identity. The natural key of an external interaction is domain identity; it is therefore not modified in v1.2.

**Status: DEFERRED — NON-BLOCKING (scheduled for v1.3)**

---

## 25. Implementation Boundary

The implementation sequence is:

```text
DB v1 Logical Model Specification v1.0
                ↓
DATABASE_SCHEMA_CONTRACT.md v1.2
                ↓
implement Drizzle schema (44 tables)
                ↓
schema index / exports
                ↓
generate migrations
                ↓
validate migrations
                ↓
implement repositories
                ↓
implement transaction manager
```

The Drizzle implementation must not invent fields, tables, relationships, or indexes that are absent from this contract without first revising the contract.

Likewise, the database contract must not silently introduce domain concepts merely because they are convenient to implement in Drizzle.

### 25.1 Recommended implementation order

```text
1. outbox-repository        (platform backbone — everything else depends on it)
2. webhook-events-repository
3. webhook-subscriptions-repository
4. webhook-deliveries-repository
5. external-interactions-repository
6. provider-credentials-repository
7. interaction-response-repository
8. interaction-moderation-repository
9. transaction-manager (enqueueWithTx)
```

The `TransactionManager.enqueueWithTx` API is the single point at which the outbox pattern becomes concrete:

```typescript
await txManager.run(async (tx) => {
  const event = await webhookEventsRepo.insert(tx, eventData);
  if (event) {
    await outboxRepo.enqueue(tx, {
      queueName: 'webhook.process',
      jobId: `webhook.process:${event.id}`,
      payload: { webhookEventId: event.id },
      traceId: event.traceId,
    });
  }
});
```

This three-line pattern is the essence of the outbox. Every other concern is infrastructure around it.

---

## 26. Contract Status

**FINAL — PRODUCTION-READY DB v1 BASELINE WITH META INTEGRATION (v1.2)**

This document is the normative physical persistence baseline for implementation. It is ready to serve as the direct basis for the Drizzle schema and clean DB v1 migration set.

The core ingestion model is unchanged from v1.0 and remains aligned with the DB v1 Logical Model Specification v1.0.

The v1.1 additions extended the persistence contract with:

- inbound Meta webhook persistence;
- encrypted provider credential storage;
- interaction response lifecycle;
- a unified transactional outbox.

The v1.2 additions are:

- `webhook_subscription_health` (inbound health companion, mirroring `source_endpoint_health`);
- `publications(external_post_id)` partial index (webhook processing hot path);
- documentation refinements to D-008, D-009, and D-013;
- a new deferred decision D-016 clarifying the future provider-aware natural key evolution.

The v1.2 additions do not alter the aggregate boundary, the interaction natural key, or any table introduced by v1.1.

The complete DB v1.2 persistence table count is **44 tables**, organized into six categories:

```text
15  core logical model
18  supporting platform persistence
 4  inbound event persistence        (v1.1)
 1  inbound health companion         (v1.2)
 5  provider credentials + response  (v1.1)
 1  platform pattern (outbox)        (v1.1)
```

The source-ingestion persistence model is finalized around:

```text
Source
  ↓
SourceEndpoint
  ↓
DiscoveryObservation
  ↓
DiscoveredResource
  ↓
RawResource
  ↓
SourceItem
  ↓
ContentItem
```

with:

```text
SourceEndpoint → SourceEndpointHealth
ContentItem → ContentUrls
ContentItem → ContentVersions
ContentItem → ContentFingerprints
ContentItem ↔ DuplicateMatches
ContentItem ↔ StoryMembers ↔ Story
```

and cross-cutting provenance through:

```text
ProvenanceEvent
```

The old source-level persistence structures:

```text
source_cursors
source_health
```

are removed from DB v1.

The DB v1.2 worker boundary is explicitly:

```text
Redis/BullMQ
  → transient execution state
  → queue scheduling
  → retries
  → worker diagnostics

PostgreSQL
  → durable pipeline state
  → canonical artifacts
  → provenance
  → endpoint health
  → webhook subscription health
  → business history
  → audit history
  → outbox intent
```

The v1.2 architectural commitment is expressed by the following invariants:

```text
PostgreSQL
  → durable domain state
  → canonical artifacts
  → provenance
  → endpoint health
  → webhook subscription health
  → business history
  → audit history
  → outbox intent

Redis/BullMQ
  → transient execution state
  → queue scheduling
  → retries
  → worker diagnostics

OutboxDispatcher
  → bridges PostgreSQL intent to Redis execution
  → never authoritative for domain state
  → recoverable at every stage
```

No production Drizzle schema or migration should diverge from this contract without a corresponding architecture-level revision.

**Implementation gate:** before changing the database structure, update the higher-level domain/logical contract when the change affects meaning or relationships, then update this document, and only then modify Drizzle schema or migrations.
