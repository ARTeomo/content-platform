# Content Automation Platform

## Technical Design Specification

**Version:** 0.9.0
**Status:** Production-Ready Architecture / Implementation Baseline
**Language:** English
**Runtime:** Node.js 22 LTS
**Language:** TypeScript 7.0
**Database:** PostgreSQL 16
**Queue:** Redis 7 + BullMQ
**Deployment:** Docker Compose / Linux VPS
**Primary Publishing Destination:** Facebook Page via authorized Meta API
**Inbound Integration:** Meta Webhook (signature-verified, outbox-backed)

**Revision history:**

- **0.8.1** — three explicit tactical implementation boundaries without changing the architecture: runtime validation of polymorphic endpoint state, configurable publication reconciliation thresholds and scheduling, and atomic AI quota enforcement in a multi-worker environment.
- **0.9.0** — integrates the Meta inbound webhook slice, the interaction response lifecycle, the provider credential lifecycle, and the unified transactional outbox. These additions do not change the system-of-record boundary, the endpoint model, the publication state machine, or the AI quota contract. They extend the platform with a well-isolated inbound event domain and formalize the outbox pattern as a platform primitive. The document is now aligned with DB contract v1.2 (44 tables) and the concrete implementation baseline.

---

# 1. Executive Summary

The Content Automation Platform is a production-oriented content discovery, analysis, moderation, scheduling, and publishing platform designed for communities.

The platform continuously discovers content from configured sources, normalizes and classifies it, determines content relevance, extracts domain entities, identifies duplicates and related stories, evaluates source reputation, optionally enriches content through an AI provider, validates the resulting publication package, applies image and attribution policies, routes content through configurable moderation, schedules approved material, and publishes it through authorized external APIs.

The platform also **receives** inbound events from external providers (starting with Meta), materializes them as first-class domain entities, and produces outbound responses through a policy- and moderation-governed workflow.

The system is designed around five fundamental principles:

```text
1. PostgreSQL is the authoritative system of record.
2. Redis/BullMQ is the asynchronous execution layer.
3. Every important state transition is explicit and auditable.
4. Uncertain external outcomes are reconciled rather than blindly retried.
5. The system fails closed when mandatory validation cannot be completed.
```

The architecture deliberately separates the domain from external services.

Facebook/Meta is therefore treated as a **publisher adapter** and an **inbound webhook provider**, not as the foundation of the application.

---

# 2. Objectives

The system shall:

- continuously discover relevant content;
- support multiple source types;
- normalize heterogeneous source formats;
- classify content using deterministic and optional AI-assisted methods;
- extract content entities;
- detect exact and near duplicates;
- group related content into story clusters;
- select the preferred source representation;
- evaluate source reputation;
- resolve and validate images;
- optionally translate and summarize content;
- validate generated content before publication;
- provide human moderation;
- support automatic publication for trusted content;
- enforce publication limits;
- support timezone-aware scheduling;
- safely interact with external APIs;
- receive, verify, and process external webhook events;
- materialize inbound interactions as durable domain entities;
- produce governed outbound responses to inbound interactions;
- rotate and validate external provider credentials;
- guarantee atomic enqueue of asynchronous work through a transactional outbox;
- recover from worker crashes;
- reconcile uncertain publication states;
- maintain comprehensive audit trails;
- expose operational metrics and health information.

---

# 3. Non-Goals

The system shall not:

- generate artificial engagement;
- mass-like third-party content;
- mass-comment on third-party content;
- create fake accounts;
- circumvent platform restrictions;
- bypass authentication;
- bypass rate limits;
- scrape protected/authenticated content without authorization;
- reproduce complete copyrighted articles;
- republish images without appropriate permission;
- impersonate source publishers;
- respond automatically to inbound interactions without a validated, deterministic policy;
- generate AI-authored outbound response text in DB v1.

---

# 4. Core Architecture

```text
                        EXTERNAL SOURCES                 META PLATFORM
                              │                               │
                              ▼                               │
                       ┌──────────────┐                       │
                       │ Source Poller│                       │
                       └──────┬───────┘                       │
                              │                               │
                       source.poll                            │
                              │                               │
                              ▼                               │
                    ┌────────────────────┐                    │
                    │ Content Normalizer │                    │
                    └─────────┬──────────┘                    │
                              │                               │
                     content.normalize                        │
                              │                               │
                              ▼                               │
                    ┌────────────────────┐                    │
                    │ Relevance Engine   │                    │
                    └─────────┬──────────┘                    │
                              │                               │
                     content.classify                         │
                              │                               │
                              ▼                               │
                    ┌────────────────────┐                    │
                    │ Entity Extractor   │                    │
                    └─────────┬──────────┘                    │
                              │                               │
                   content.entity_extract                     │
                              │                               │
                              ▼                               │
                 ┌──────────────────────────┐                 │
                 │ Deduplication Engine     │                 │
                 └────────────┬─────────────┘                 │
                              │                               │
                     duplicate_check                          │
                              │                               │
                              ▼                               │
                 ┌──────────────────────────┐                 │
                 │ Story/Entity Clustering  │                 │
                 └────────────┬─────────────┘                 │
                              │                               │
                              ▼                               │
                    ┌────────────────────┐                    │
                    │ PostgreSQL         │                    │
                    │ System of Record   │                    │
                    └─────────┬──────────┘                    │
                              │                               │
                              ▼                               │
                    ┌────────────────────┐                    │
                    │ Conflict Resolver  │                    │
                    └─────────┬──────────┘                    │
                              │                               │
                              ▼                               │
                    ┌────────────────────┐                    │
                    │ Content Processor  │                    │
                    │ Summary / Language │                    │
                    └─────────┬──────────┘                    │
                              │                               │
                              ▼                               │
                    ┌────────────────────┐                    │
                    │ Content Validator  │                    │
                    └─────────┬──────────┘                    │
                              │                               │
                              ▼                               │
                    ┌────────────────────┐                    │
                    │ Image Policy       │                    │
                    │ + Image Resolver   │                    │
                    └─────────┬──────────┘                    │
                              │                               │
                              ▼                               │
                    ┌────────────────────┐                    │
                    │ Moderation         │                    │
                    └─────────┬──────────┘                    │
                              │                               │
                              ▼                               │
                    ┌────────────────────┐                    │
                    │ Publication        │                    │
                    │ Scheduler          │                    │
                    └─────────┬──────────┘                    │
                              │                               │
                              ▼                               │
                    ┌────────────────────┐                    │
                    │ Publication Lock   │                    │
                    └─────────┬──────────┘                    │
                              │                               │
                              ▼                               │
                    ┌────────────────────┐                    │
                    │ Publisher Adapter  │                    │
                    │ (Meta)             │                    │
                    └─────────┬──────────┘                    │
                              │                               │
                              ▼                               │
                    ┌────────────────────┐                    │
                    │ External Platform  │                    │
                    └─────────┬──────────┘                    │
                              │                               │
                     ┌────────┴─────────┐                     │
                     ▼                  ▼                     │
                CONFIRMED            UNKNOWN                  │
                     │                  │                     │
                     ▼                  ▼                     │
                PUBLISHED         RECONCILIATION              │
                                                              │
        ──────────────────────────────────────────────────────┤
                                                              │
        INBOUND (webhook)                                     │
                                                              │
                    ┌────────────────────┐                    │
                    │ Webhook Ingress    │◄───────────────────┘
                    │ (apps/api)         │
                    │  - signature verify│
                    │  - Zod envelope    │
                    │  - DB tx + outbox  │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │ webhook.process    │
                    │ (apps/worker)      │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │ External           │
                    │ Interactions       │
                    │ (materialized)     │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │ Response Policy    │
                    │ Engine             │
                    └─────────┬──────────┘
                              │
                     ┌────────┴─────────┐
                     ▼                  ▼
               AUTO_RESPOND       MODERATION_REQUIRED
                     │                  │
                     └────────┬─────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │ webhook.respond    │
                    │ (apps/worker)      │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │ Meta Graph API     │
                    │ (comment / mention)│
                    └─────────┬──────────┘
                              │
                              └──────► (push reconciliation:
                                       own response → feed webhook)

        ═══════════════════════════════════════════════════════
                       PLATFORM BACKBONE

        ┌────────────────────────────────────────────────────┐
        │  PostgreSQL  —  system of record                   │
        │  outbox_jobs —  transactional outbox               │
        │  Redis/BullMQ — asynchronous execution             │
        │  OutboxDispatcher — DB → Redis bridge              │
        └────────────────────────────────────────────────────┘
```

The outbound pipeline (content discovery → publication) is unchanged from v0.8.1. The inbound pipeline (webhook ingress → interaction response) is new in v0.9.0 and is fully isolated behind its own domain entities, its own queues, and its own rate limiter.

---

# 5. System of Record

PostgreSQL is the authoritative source of business state.

Redis/BullMQ does not contain authoritative business information.

If Redis is lost:

```text
PostgreSQL
    ↓
reconstruct pending work
    ↓
repopulate queues
```

The database remains intact.

The outbox pattern (`outbox_jobs`) is the only bridge between durable domain state and the asynchronous execution layer. See §144.

---

# 6. Repository Structure

```text
content-platform/
│
├── apps/
│   ├── api/                          HTTP API and webhook ingress
│   ├── worker/                       Background workers + OutboxDispatcher
│   └── admin/                        Administrative UI
│
├── packages/
│   ├── domain/                       Domain types and invariants
│   ├── config/                       Configuration service
│   ├── database/                     Drizzle schema, migrations, repositories
│   ├── queues/                       Queue definitions and job contracts
│   ├── source-adapters/              Endpoint-oriented ingestion adapters
│   ├── normalization/                Deterministic canonicalization
│   ├── relevance/                    Relevance engine
│   ├── entities/                     Entity extraction
│   ├── deduplication/                Exact and fuzzy duplicate detection
│   ├── clustering/                   Story clustering
│   ├── conflict-resolution/          Preferred representation selection
│   ├── reputation/                   Source reputation
│   ├── content-processing/           Summary, translation, captions
│   ├── validation/                   Content validation service
│   ├── images/                       Image policy and resolver
│   ├── moderation/                   Moderation workflow
│   ├── scheduling/                   Timezone-aware scheduling
│   ├── publishers/                   Publisher adapters (incl. Meta)
│   ├── webhooks/                     Inbound webhook domain
│   │   ├── ingress/                  HTTP layer (signature, Zod, tx)
│   │   ├── processing/               webhook.process worker
│   │   └── respond/                  webhook.respond worker + policy
│   ├── interaction-response/         Interaction response lifecycle
│   ├── outbox/                       Transactional outbox + dispatcher
│   ├── authentication/               Credential lifecycle (Meta)
│   ├── audit/                        Audit trail
│   ├── notifications/                Notification service
│   ├── observability/                Logs, metrics, traces, health
│   └── shared/                       Cross-cutting utilities
│
├── docs/
│   ├── architecture/
│   ├── conventions/
│   ├── operations/
│   └── adr/
│
├── migrations/                       (owned by packages/database)
├── tests/
│
├── docker-compose.yml
├── docker-compose.dev.yml
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

---

# 7. Queue Architecture

Queues:

```text
── Ingestion ──────────────────────────────────────────
source.poll

── Content pipeline ───────────────────────────────────
content.normalize
content.classify
content.entity_extract
content.duplicate_check
content.cluster
content.resolve_conflict
content.process
content.validate
content.image_resolve
content.moderate
content.publish
publication.reconcile

── Webhook (inbound) ──────────────────────────────────
webhook.process
webhook.respond
webhook.respond.reconcile

── Credentials ────────────────────────────────────────
meta.credential.refresh

── System ─────────────────────────────────────────────
system.rebuild
system.outbox.cleanup
retry.queue
```

**Queue count:** 20.

**Changes from v0.8.1:**

- Added: `webhook.process`, `webhook.respond`, `webhook.respond.reconcile`
- Added: `meta.credential.refresh`
- Added: `system.outbox.cleanup`
- The legacy `webhook.ingest` queue from earlier drafts is **not** present. The webhook ingress persists and enqueues within a single PostgreSQL transaction; there is no separate ingest queue.

---

# 8. Queue Responsibilities

### source.poll

Fetch configured sources.

### content.normalize

Convert raw source data to canonical form.

### content.classify

Calculate relevance and categories.

### content.entity_extract

Extract domain entities.

### content.duplicate_check

Perform exact and fuzzy duplicate detection.

### content.cluster

Associate content with an existing story cluster or create a new cluster.

### content.resolve_conflict

Select the preferred representation of a story.

### content.process

Generate summaries, translations and captions.

### content.validate

Run mandatory publication validation.

### content.image_resolve

Resolve eligible media.

### content.moderate

Prepare moderation state.

### content.publish

Execute external publication.

### publication.reconcile

Resolve uncertain external publication states.

### webhook.process

Load a received `webhook_events` row, materialize `external_interactions`, and update event status. Never calls Graph API on the hot path. See §141.

### webhook.respond

Execute an approved or auto-approved outbound response through the Meta interaction adapter. See §142.

### webhook.respond.reconcile

Investigate `UNKNOWN` or stale `IN_PROGRESS` interaction responses via push or pull reconciliation. See §142.

### meta.credential.refresh

Rotate and validate provider credentials according to lifecycle state. See §143.

### system.rebuild

Reconstruct pending jobs from PostgreSQL. Includes both outbox dispatch recovery and domain-state rebuild. See §144.6.

### system.outbox.cleanup

Delete `DISPATCHED` outbox rows older than the configured retention window. Runs on its own cron schedule. See §144.7.

### retry.queue

Dead-letter and manual-retry queue.

---

# 9. Source and SourceEndpoint Model

A `Source` represents the logical publisher, brand, or other content origin. A `SourceEndpoint` represents one concrete technical access point belonging to that source.

The relationship is:

```text
Source
  └── 1:N SourceEndpoint
          ├── capabilities
          ├── state + state_version
          └── SourceEndpointHealth
```

A source may expose multiple endpoints for different discovery, acquisition, or extraction strategies. Endpoint-specific configuration, incremental state, scheduling, and operational health must not be stored on the logical source.

The logical source has no `type` or `url` field. Those properties belong to `SourceEndpoint`.

The canonical source lifecycle is:

```text
ACTIVE
PAUSED
DISABLED
```

Source reputation is independent of lifecycle state:

```text
VERIFIED
NEUTRAL
FLAGGED
```

---

# 10. Endpoint State and Incremental Polling

Incremental ingestion state belongs to the endpoint that owns the corresponding access mechanism. The legacy `SourceCursor` entity and `source_cursors` persistence table are removed from the architecture.

Endpoint state is polymorphic and is represented by a discriminated structure whose `kind` is one of:

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

The endpoint state is persisted in PostgreSQL as endpoint-owned state. An endpoint may therefore maintain an RSS/Atom feed boundary, sitemap position, pagination cursor, or API continuation token without coupling those details to the logical source.

A poll should preferentially request only new content. If the endpoint supports incremental retrieval, its current persisted state should define the retrieval boundary. If incremental retrieval is unavailable, the handler may retrieve a bounded recent window subject to endpoint and source safety limits.

---

# 11. Endpoint State Concurrency

Endpoint state is protected by optimistic concurrency through `state_version`.

The persistence contract is:

```text
read endpoint state + state_version
        ↓
perform bounded operation
        ↓
persist accepted artifacts
        ↓
update endpoint state
where state_version = observed version
        ↓
increment state_version
```

A state update must succeed only when the persisted version still equals the version observed by the worker. A successful update writes the new state and increments `state_version` atomically.

If the optimistic lock fails, the worker must not overwrite newer endpoint state. The worker must treat the conflict as a concurrency outcome and allow the current persisted state to remain authoritative.

Where accepted discovery artifacts and endpoint state advancement are part of the same durable operation, they must be committed in one PostgreSQL transaction. A failed transaction must leave the previous endpoint state intact.

Redis/BullMQ does not own endpoint state and must never be treated as the authoritative cursor or incremental boundary.

### 11.1 Endpoint State Runtime Validation Boundary

The domain and persistence contract requires the polymorphic endpoint `state` JSONB value to conform to its declared `kind` and the corresponding supported state variant. Runtime validation must therefore reject malformed, unsupported, or internally inconsistent endpoint state before it is accepted as authoritative state.

The concrete runtime validation mechanism, validator library, schema organization, and exact placement within the TypeScript application are implementation decisions. A schema-based runtime validator such as Zod may be used, but no specific validation library is mandated by this specification.

The implementation must preserve the following invariant:

```text
Persisted endpoint state
        ↓
valid supported state variant
        ↓
accepted as authoritative state
```

Invalid state must fail closed and must not silently advance or replace the endpoint state.

---

# 12. Source Endpoint Adapter Contract

The ingestion layer operates on technical endpoints rather than on a source-level transport type. The canonical flow is:

```text
Logical Source
      ↓
SourceEndpoint
      ↓
Discovery / Acquisition / Extraction handler
      ↓
DiscoveredResource / RawResource / SourceItem
      ↓
ContentItem
      ↓
Content Pipeline
```

The canonical domain concepts are:

```typescript
type EndpointCapability = 'DISCOVERY' | 'ACQUISITION' | 'EXTRACTION';

type OperationPhase = 'DISCOVERY' | 'ACQUISITION' | 'EXTRACTION';

type DiscoveryMethod =
  | 'RSS_FEED'
  | 'ATOM_FEED'
  | 'JSON_FEED'
  | 'SITEMAP_XML'
  | 'HTML_LISTING'
  | 'API_POLL'
  | 'DIRECT_SEED';

type AcquisitionMethod = 'HTTP_FETCH' | 'HEADLESS_BROWSER' | 'BYPASSED_INLINE';

type ExtractionMethod =
  'RSS_INLINE_EXTRACTOR' | 'GENERIC_ARTICLE_EXTRACTOR' | 'CUSTOM_DOM_EXTRACTOR';

type OperationMethod = DiscoveryMethod | AcquisitionMethod | ExtractionMethod;

interface Provenance {
  sourceId: string;
  endpointId: string;
  phase: OperationPhase;
  method: OperationMethod;
  observedAt: Date;
}

interface SourceEndpoint {
  id: string;
  sourceId: string;
  representation: 'XML' | 'HTML' | 'JSON' | 'UNKNOWN';
  capabilities: EndpointCapability[];
  url: string;
  configuration?: Record<string, unknown>;
  state: EndpointState;
  health: {
    consecutiveFailures: number;
    lastSuccessAt?: Date;
    lastFailureAt?: Date;
    lastError?: string;
  };
  updatedAt: Date;
}

type EndpointState =
  | FeedEndpointState
  | SitemapEndpointState
  | PaginationEndpointState
  | ApiEndpointState
  | StatelessEndpointState;

interface FeedEndpointState {
  kind: 'FEED';
  lastItemId?: string;
  lastPublishedAt?: Date;
  lastHash?: string;
}

interface SitemapEndpointState {
  kind: 'SITEMAP';
  lastSeenUrl?: string;
  lastModified?: Date;
}

interface PaginationEndpointState {
  kind: 'PAGINATION';
  pageCursor?: string;
  lastSeenUrl?: string;
}

interface ApiEndpointState {
  kind: 'API';
  nextPageToken?: string;
  lastOffset?: number;
}

interface StatelessEndpointState {
  kind: 'STATELESS';
}

interface DiscoveredResource {
  canonicalUrl: string;
  externalId?: string;
  publishedAt?: Date;
  metadata?: {
    title?: string;
    description?: string;
    inlineContent?: string;
    [key: string]: unknown;
  };
  provenance: Provenance;
}

interface DiscoveryResult {
  resources: DiscoveredResource[];
  nextState: EndpointState;
  metrics: {
    discoveredCount: number;
    skippedCount: number;
    malformedCount: number;
  };
}

type AcquisitionAction = 'REQUIRED' | 'SKIPPED';
type ExtractionAction = 'INLINE' | 'RAW';

interface ProcessingDecision {
  acquisition: AcquisitionAction;
  extraction: ExtractionAction;
  resource: DiscoveredResource;
}

interface RawResource {
  url: string;
  contentType: string;
  body: string;
  fetchedAt: Date;
  provenance: Provenance;
}

interface SourceItem {
  sourceId: string;
  sourceItemId: string;
  sourceUrl: string;
  title: string;
  description?: string;
  content: string;
  author?: string;
  language?: string;
  publishedAt?: Date;
  discoveredAt: Date;
  provenanceTrail: Provenance[];
}

interface DiscoveryHandler {
  discover(endpoint: SourceEndpoint, state: EndpointState): Promise<DiscoveryResult>;
}

interface AcquisitionHandler {
  acquire(resource: DiscoveredResource, endpoint?: SourceEndpoint): Promise<RawResource>;
}

interface ExtractionHandler {
  extractFromRaw(raw: RawResource): Promise<SourceItem>;
  extractFromInline(discovered: DiscoveredResource): SourceItem;
}
```

The canonical contract must not contain transport-specific response types, HTTP client types, XML parser types, provider SDK request structures, PostgreSQL/Drizzle types, or Redis/BullMQ types.

## 12.1 Endpoint Capability Model

An endpoint may support one or more phases:

```text
DISCOVERY
ACQUISITION
EXTRACTION
```

This allows a single endpoint to provide inline content during discovery or to participate in multiple processing phases, while keeping the operation phase explicit in provenance.

The endpoint representation is one of:

```text
XML
HTML
JSON
UNKNOWN
```

The representation describes the technical representation encountered at the endpoint. It is not a logical source type.

## 12.2 Discovery Contract

Discovery handlers receive a `SourceEndpoint` and its persisted `EndpointState`. They return candidate resources together with the next endpoint state and discovery metrics.

A successful discovery operation must:

- return canonical candidate resource identities rather than canonical internal content;
- preserve endpoint provenance for every discovered resource;
- produce a deterministic `nextState`;
- respect configured safety limits;
- report skipped and malformed input through observable metrics;
- avoid advancing endpoint state until accepted discovery results have been durably persisted.

The discovery result is not itself a publication-ready content object. `DiscoveredResource` is the candidate identity layer between technical discovery and content acquisition/extraction.

## 12.3 Acquisition and Extraction Contract

Acquisition is required when discovery does not already provide sufficient inline content for downstream extraction. It produces a `RawResource` snapshot. Extraction converts raw or inline data into a structured `SourceItem`.

The processing decision is explicit:

```text
DiscoveredResource
      ↓
ProcessingDecision
   ┌──┴───────────────┐
   ↓                  ↓
acquire              skip
   ↓                  ↓
RawResource       inline/raw path
   └───────┬──────────┘
           ↓
      SourceItem
```

A `SourceItem` is an intermediate source representation. It is not the same entity as canonical `ContentItem`.

## 12.4 Adapter Error Contract

Ingestion failures must be classified into operationally meaningful categories:

```text
INVALID_SOURCE
REQUEST_TIMEOUT
RESPONSE_TOO_LARGE
UNSUPPORTED_FORMAT
MALFORMED_RESPONSE
AUTHENTICATION_ERROR
AUTHORIZATION_ERROR
RATE_LIMIT
NETWORK_ERROR
TEMPORARY_SOURCE_ERROR
UNKNOWN
```

The exact transport or parser error remains inside the implementation. The application layer receives a canonical classification suitable for endpoint-health handling, retry decisions, metrics, and audit records.

A malformed or unsafe response must fail closed. It must not be converted into partially trusted content merely to keep the pipeline moving.

## 12.5 Endpoint Handler Selection

Handler selection is based on endpoint capabilities, representation, and the operation being performed. The domain must not contain transport-specific branching such as `if RSS`, `if Atom`, or `if HTTP`.

The implementation-selection boundary must be explicit and deterministic. Unsupported endpoint capabilities or methods must fail closed rather than silently selecting an unrelated handler.

The adapter package may internally register concrete handlers for RSS, Atom, JSON Feed, sitemap, HTML listing, API, HTTP acquisition, browser acquisition, and custom extraction strategies. Those implementations must expose only the canonical endpoint-oriented contract to the rest of the application.

## 12.6 Source Onboarding and Endpoint Test Fetch

Source onboarding and endpoint onboarding are separate configuration concerns:

```text
Source creation
      ↓
Endpoint configuration
      ↓
endpoint validation
      ↓
bounded test discovery/acquisition/extraction
      ↓
content sample
      ↓
relevance evaluation
      ↓
image policy evaluation
      ↓
initial reputation
```

A logical source may have multiple endpoints. Adding or disabling one endpoint must not require duplicating the logical source.

A test operation must be bounded by the same safety principles as normal execution and must not itself establish a trusted reputation state.

## 12.7 Endpoint Boundary Rules

The following dependencies are prohibited from the domain package:

```text
HTTP clients
RSS parsers
Atom parsers
JSON Feed libraries
XML libraries
HTML transport clients
Meta API clients
PostgreSQL/Drizzle
Redis/BullMQ
```

The source-adapters package may depend on transport and parsing libraries, but it must expose only the canonical endpoint-oriented contract to the rest of the application.

Replacing RSS with an official API, a sitemap, or an HTML listing must not require changes to normalization, relevance, entity extraction, deduplication, clustering, conflict resolution, moderation, scheduling, or publication.

---

# 13. Content Normalization

The normalization pipeline converts an accepted `SourceItem` into the canonical internal `ContentItem` representation.

Normalization is deterministic and must not perform editorial classification, relevance scoring, story assignment, moderation, publication decisions, or AI-generated rewriting.

The normalization pipeline performs the following operations in this order:

```text
HTML decoding
      ↓
HTML sanitization
      ↓
charset normalization
      ↓
whitespace normalization
      ↓
URL canonicalization
      ↓
date normalization
      ↓
title normalization
      ↓
description extraction
      ↓
language detection
```

The normalized content becomes the canonical internal representation.

## 13.1 Normalization Principles

Each normalization step:

- receives the current canonical normalization document;
- may transform only fields relevant to its responsibility;
- must preserve source identity and source provenance;
- must be deterministic for the same input;
- must not introduce editorial meaning;
- must not silently discard source content without a defined normalization rule.

Normalization must not invent values for fields that cannot be derived from the accepted source data.

The pipeline must preserve the distinction between:

```text
SourceItem
    ↓
normalized ContentItem
```

A normalization step must not create relevance, category, entity, story, moderation, scheduling, or publication state.

## 13.2 HTML Decoding

HTML character references and encoded HTML entities are decoded before sanitization.

Examples include:

```text
&amp;  → &
&quot; → "
&#39;  → '
```

Decoding must not be treated as HTML sanitization. The decoded result is passed to the sanitization step.

## 13.3 HTML Sanitization

HTML is sanitized before normalized content is persisted.

The sanitizer must:

- remove unsafe elements;
- remove unsafe attributes;
- restrict link protocols to explicitly allowed protocols;
- prevent executable or active content;
- preserve only the limited markup required by the canonical content representation.

The exact sanitizer implementation is package-specific, but the canonical result must be safe for downstream processing.

## 13.4 Charset Normalization

Text is normalized to a consistent Unicode representation.

The canonical representation uses Unicode NFC normalization.

This prevents canonically equivalent Unicode sequences from producing different normalized values or fingerprints.

## 13.5 Whitespace Normalization

Whitespace normalization must:

- collapse consecutive whitespace characters into a single space where the field is treated as normalized text;
- remove leading whitespace;
- remove trailing whitespace.

Normalization must not introduce significant whitespace that was not present in the source.

## 13.6 URL Canonicalization

Source URLs are normalized into a deterministic canonical representation.

At minimum:

- surrounding whitespace is removed;
- malformed URLs remain invalid rather than being silently repaired;
- URL normalization must not change the destination semantics.

More extensive URL canonicalization may be implemented by the normalization package when its rules are explicitly defined and consistently applied.

## 13.7 Date Normalization

Dates are represented as canonical JavaScript `Date` values internally.

The normalized value must represent the same instant as the accepted source value.

No date may be silently shifted merely to match the application timezone. Business scheduling timezone rules are applied later by the scheduling subsystem.

## 13.8 Title Normalization

The title is a required canonical text field.

Title normalization must:

- operate on the already decoded and sanitized title;
- apply Unicode normalization;
- apply normalized whitespace handling;
- remove leading and trailing whitespace;
- remove non-content control characters that cannot form meaningful title text;
- preserve the source title's wording and semantic content;
- preserve capitalization unless a separate editorial rule explicitly changes it;
- preserve meaningful punctuation;
- never append source names, categories, entities, or other editorial text;
- never generate a replacement title from AI or heuristics.

Title normalization must not truncate the title. Maximum title length is a validation concern and is enforced by the content validation service.

If normalization produces an empty title, the content must not be treated as a valid normalized item. The failure must remain observable to the normalization workflow and must not be silently converted into a placeholder title.

The title normalization step is therefore a canonicalization step, not an editorial rewriting step.

## 13.9 Description Extraction

`description` is an optional canonical field.

The extraction algorithm is deterministic:

```text
1. Use the source-provided description when it exists and
   contains meaningful normalized text.

2. Otherwise, derive a description from the available content.

3. If no meaningful content exists, leave description undefined.
```

When deriving a description from `content`:

- use the already decoded and sanitized content;
- remove markup that is not part of the canonical textual description;
- normalize whitespace;
- preserve the original textual order;
- do not generate new wording;
- do not summarize with AI;
- do not add source attribution;
- do not add editorial interpretation.

Description extraction must not alter the canonical `content` field.

The normalization layer must not impose a publication-oriented character limit on the extracted description. Publication and validation limits are enforced by the content validation service.

A source-provided description takes precedence over a derived description when it contains meaningful normalized text.

If the source-provided description is empty or contains no meaningful text after normalization, it is treated as absent and the extraction fallback may be used.

## 13.10 Language Detection

Language detection runs after text normalization so that detection operates on canonical text.

The detected language is stored using the canonical language identifier expected by the domain model.

If there is insufficient meaningful text for reliable detection, the language remains undefined rather than being guessed.

## 13.11 Normalization Output

After all normalization steps complete:

```text
ContentItem.status = NORMALIZED
```

The resulting `ContentItem` is the canonical input to downstream relevance, entity extraction, deduplication, clustering, conflict resolution, processing, validation, moderation, scheduling, and publication workflows.

Normalization must be idempotent as far as the individual canonicalization rules permit: applying the same normalization rules to an already normalized representation must not continually alter the content.

---

# 14. Content Validation Service

A mandatory `ContentValidationService` runs before moderation.

Responsibilities:

- URL validation;
- redirect validation;
- title validation;
- summary validation;
- caption validation;
- character limits;
- HTML sanitization;
- Unicode normalization;
- emoji validation;
- attribution validation;
- category consistency;
- relevance consistency;
- image rights validation.

Interface:

```typescript
interface ContentValidationService {
  validate(content: PublicationCandidate): Promise<ValidationResult>;
}
```

---

# 15. Validation Result

```typescript
interface ValidationResult {
  status: 'PASS' | 'FAIL' | 'REVIEW';
  errors: ValidationError[];
  warnings: ValidationWarning[];
}
```

A mandatory error blocks publication.

A warning may be shown to the moderator.

---

# 16. URL Validation

The validator should:

1. parse the URL;
2. verify protocol;
3. normalize hostname;
4. follow a bounded redirect chain where appropriate;
5. reject unsafe destinations;
6. detect malformed URLs;
7. verify that the final destination is consistent with the source.

The system should not follow arbitrary unbounded redirects.

---

# 17. Content Length Validation

Configurable limits:

```text
title.max_length
summary.max_length
caption.max_length
```

The validator must measure Unicode text correctly rather than relying solely on byte length.

---

# 18. Unicode Normalization

Text is normalized to a consistent Unicode form.

This prevents visually identical strings from producing different fingerprints.

---

# 19. Story Clustering

Deduplication answers:

> "Is this the same content?"

Story clustering answers:

> "Is this about the same underlying event?"

These are different questions.

Example:

```text
Source A:
Brand announces model 59999

Source B:
New Brand revealed

Source C:
Brand catalogue adds 59999
```

The articles may be different documents but belong to one story cluster.

---

# 20. Story Model

```text
Story
-----
id
canonical_entity_hash
primary_content_id
status
first_seen_at
last_seen_at
source_count
confidence
created_at
updated_at
```

---

# 21. Story Status

```text
NEW
ACTIVE
PUBLISHED
ARCHIVED
MERGED
```

---

# 22. Conflict Resolution Service

The `ConflictResolutionService` operates at story-cluster level.

Responsibilities:

- choose preferred source;
- choose preferred article;
- choose best image;
- choose strongest entity representation;
- determine publication candidate;
- retain alternative sources.

---

# 23. Source Selection Priority

Default ordering:

```text
1. Explicit source priority
2. Source reputation
3. Content completeness
4. Entity extraction confidence
5. Image eligibility
6. Publication date
```

This ordering must be configurable.

---

# 24. Multi-Source Attribution

A story may contain multiple source references.

Example:

```text
Primary source:
Source A

Additional coverage:
Source B
Source C
```

The publication normally links to the selected primary source.

The alternative sources remain stored internally.

---

# 25. Story Merge

Two stories may later be discovered to represent the same event.

The system should support:

```text
Story A
   +
Story B
   ↓
MERGED
   ↓
Canonical Story
```

Merges must be audited.

---

# 26. Story Split

If an incorrect cluster is discovered:

```text
Story A
   ↓
incorrectly grouped items
   ↓
split
   ↓
Story A + Story B
```

This must also be audited.

---

# 27. Source Reputation

Source reputation remains an independent subsystem.

Metrics:

```text
relevance_rate
duplicate_rate
manual_accept_rate
manual_reject_rate
feed_success_rate
feed_latency
publication_success_rate
content_quality
```

---

# 28. Reputation Calculation

The score is normalized to:

```text
0–100
```

Example:

```text
30% relevance
20% moderation acceptance
15% duplicate rate
15% source reliability
10% publication reliability
10% content quality
```

---

# 29. Reputation Decay

Recent performance should matter more than very old history.

The system may use a rolling window:

```text
last 30 days
```

or weighted decay.

This prevents a source from permanently retaining a high score after its quality deteriorates.

---

# 30. Reputation State

```text
HIGH_TRUST
NORMAL
LOW_TRUST
BLOCKED
```

Automatic transitions should be configurable.

---

# 31. AI Quota Service

AI processing must have explicit cost controls.

```typescript
interface AIQuotaService {
  canExecute(operation: AIOperation, estimatedCost: number): Promise<boolean>;

  recordUsage(usage: AIUsage): Promise<void>;
}
```

---

# 32. AI Limits

Possible limits:

```text
daily requests
monthly requests
daily estimated cost
monthly estimated cost
per-source limits
per-category limits
```

Example:

```text
AI_MONTHLY_BUDGET = 20 EUR
```

### 32.1 AI Quota Enforcement Boundary

Quota enforcement must be atomic and must remain correct when multiple workers attempt AI operations concurrently. The implementation must prevent a race in which parallel workers independently observe available quota and collectively exceed the configured limit.

The persistence and service contract therefore defines the observable guarantee, while the concrete concurrency mechanism remains an implementation decision. The implementation may use an atomic database update, transactional row locking, an appropriate transaction isolation strategy, or another distributed locking technique that provides the required guarantee.

No particular locking primitive is mandated by this specification. The selected mechanism must ensure that quota reservation/enforcement cannot be bypassed by worker concurrency and that the authoritative usage state remains consistent in PostgreSQL.

The invariant is:

```text
Concurrent AI requests
        ↓
atomic quota decision
        ↓
within configured limit
or
rejected before execution
```

---

# 33. AI Fallback

If the quota is exhausted:

```text
AI unavailable
      ↓
Use original title
      ↓
Use source excerpt
      ↓
Manual moderation
```

The content pipeline must remain operational.

---

# 34. AI Provider Failure

AI failures must not block the entire ingestion pipeline.

Instead:

```text
AI failure
   ↓
retry
   ↓
fallback
   ↓
manual review
```

depending on configuration.

---

# 35. AI Cost Accounting

Each AI request records:

```text
provider
model
operation
input_tokens
output_tokens
estimated_cost
timestamp
content_id
```

This permits budget analysis.

---

# 36. Bulk Moderation

The administration interface shall support:

```text
bulk approve
bulk reject
bulk archive
bulk schedule
```

Bulk actions require confirmation.

---

# 37. Bulk Action Safety

Bulk actions must respect individual item validation.

For example:

```text
100 selected items
      ↓
5 fail mandatory validation
      ↓
95 eligible
      ↓
show confirmation
```

The system must not silently publish invalid items.

---

# 38. Bulk Audit

One bulk action generates:

```text
bulk_action
```

plus individual item-level audit records.

This maintains traceability.

---

# 39. Publication Preview

The administrator can view:

```text
Tomorrow's publication plan
```

Example:

```text
08:30  product announcement
11:00  Layout construction article
14:30  DCC tutorial
18:00  New rolling stock
```

---

# 40. Preview Editing

The administrator may:

- reorder;
- edit caption;
- change publication time;
- remove an item;
- replace an image;
- approve/reject.

---

# 41. Publication Calendar

The admin interface should provide a calendar or timeline view.

```text
MON
08:30 ─ Brand1
12:00 ─ Layout
18:00 ─ DCC

TUE
09:00 ─ Brand2
14:00 ─ Brand3
```

---

# 42. Scheduling Engine

The scheduling engine evaluates:

```text
current time
configured timezone
day of week
publication window
daily limits
minimum interval
category limits
source limits
priority
```

---

# 43. Timezone

All timestamps are stored as UTC.

Business scheduling uses an explicit IANA timezone.

Default example:

```text
Europe/Budapest
```

The application must never depend on the Docker host timezone.

---

# 44. Publication Window

Example:

```json
{
  "timezone": "Europe/Budapest",
  "from": "08:00",
  "until": "22:00"
}
```

---

# 45. Trace ID

Every content lifecycle receives a trace ID.

```text
trace_id = UUID
```

The trace ID is propagated through:

```text
source.poll
normalize
classify
entity extraction
deduplication
processing
validation
moderation
scheduling
publication
reconciliation
```

Additionally, the following inbound and platform paths propagate a `trace_id`:

```text
webhook ingress (generated at receipt, propagated downstream)
webhook.process
webhook.respond
credential refresh
outbox dispatch (carried in the outbox row when the enqueuing path provides it)
```

---

# 46. Trace Context

Logs should include:

```text
traceId
contentId
storyId
sourceId
jobId
publicationId
webhookEventId
interactionId
responseId
```

This enables complete lifecycle reconstruction.

---

# 47. Distributed Tracing

Future implementation may use OpenTelemetry.

The trace model should support:

```text
Source Poll
   └── Normalize
        └── Classify
             └── Dedup
                  └── Process
                       └── Validate
                            └── Publish

Meta Webhook
   └── Webhook Ingress
        └── Webhook Process
             └── Interaction Response
                  └── Webhook Respond
                       └── Push Reconciliation (feed webhook)
```

---

# 48. Queue Replay Service

The queue is reconstructible from PostgreSQL state.

The `QueueReplayService` shall:

1. inspect persistent records;
2. identify incomplete state transitions;
3. determine the correct next pipeline stage;
4. create missing jobs;
5. avoid creating jobs for completed states.

In v0.9.0 the replay service additionally inspects:

- `outbox_jobs` with `status = 'PENDING'`
- `outbox_jobs` with `status = 'DISPATCHING'` and stale `last_attempt_at`
- `webhook_events` with `status = 'RECEIVED'` or `status = 'FAILED'`
- `webhook_events` with `status = 'PROCESSING'` and stale `updated_at`
- `interaction_responses` with `status = 'UNKNOWN'` or stale `IN_PROGRESS`

The replay service never reconstructs business state from Redis.

---

# 49. Queue Recovery

Example:

```text
Redis lost
   ↓
Redis recreated
   ↓
system.rebuild
   ↓
PostgreSQL inspected (including outbox_jobs)
   ↓
pending work identified
   ↓
queues repopulated
```

No business state is reconstructed from Redis.

The outbox dispatch recovery path ensures that any `DISPATCHING` row that was in flight when Redis was lost is restored to `PENDING` and redispatched with the same deterministic `job_id`.

---

# 50. Replay Safety

The replay service must be idempotent.

Running:

```text
system.rebuild
```

twice must not result in duplicate publications, duplicate responses, or duplicate webhook processing.

The outbox's deterministic `job_id` and BullMQ's job-ID deduplication guarantee that a recovered `outbox_jobs` row cannot produce a duplicate downstream job.

---

# 51. State-to-Queue Mapping

Example:

```text
CLASSIFIED
→ content.entity_extract

ENTITY_EXTRACTED
→ content.duplicate_check

UNIQUE
→ content.cluster

CLUSTERED
→ content.resolve_conflict

APPROVED
→ content.publish
```

Completed states must not be re-enqueued.

### Inbound state-to-queue mappings (new in v0.9.0)

```text
webhook_events.status = RECEIVED
→ webhook.process

webhook_events.status = PROCESSING (stale)
→ webhook.process (recovery)

webhook_events.status = FAILED (retry-eligible)
→ webhook.process (via BullMQ retry)

interaction_responses.status = AUTO_APPROVED
→ webhook.respond

interaction_responses.status = APPROVED
→ webhook.respond

interaction_responses.status = SCHEDULED (scheduled_at <= now())
→ webhook.respond

interaction_responses.status = UNKNOWN
→ webhook.respond.reconcile

interaction_responses.status = IN_PROGRESS (stale)
→ webhook.respond.reconcile

provider_credentials.status = EXPIRING
→ meta.credential.refresh

outbox_jobs.status = PENDING
→ OutboxDispatcher

outbox_jobs.status = DISPATCHING (stale)
→ OutboxDispatcher (recovery)
```

---

# 52. Stale Job Detection

Jobs that exceed their expected execution duration are flagged.

Example:

```text
content.process
expected: 2 minutes
actual: 20 minutes
```

→ operational warning.

In v0.9.0, the following additional staleness conditions apply:

```text
webhook_events.status = PROCESSING
threshold: WEBHOOK_PROCESSING_TIMEOUT_SECONDS (default 300)

outbox_jobs.status = DISPATCHING
threshold: OUTBOX_DISPATCH_STALE_THRESHOLD_SECONDS (default 60)

interaction_responses.status = IN_PROGRESS
threshold: WEBHOOK_RESPONSE_STALE_THRESHOLD_MINUTES (default 5)
```

Stale states are recoverable by `system.rebuild` and, for the response and outbox cases, by their respective reconciliation or recovery paths.

---

# 53. Publication Lock

Publication lock key:

```text
publication:{contentId}:{destinationId}
```

`destinationId` identifies a persisted publication destination. The destination is a first-class persistence entity rather than an implicit property of the publisher adapter.

The lock prevents concurrent attempts.

**Outbound response lock (new in v0.9.0):**

```text
webhook.respond:{responseId}
```

Response execution is guarded by the deterministic BullMQ `job_id` and by the atomic status transition of the `interaction_responses` row.

---

# 54. Publication Reservation

Before calling the external API:

```text
BEGIN

acquire logical publication lock

verify no successful publication exists

create/update publication attempt

mark IN_PROGRESS

COMMIT
```

Only then may the external API be called.

**Outbound response reservation (new in v0.9.0):**

Before calling the Graph API for an outbound response:

```text
BEGIN

verify interaction_responses.status IN ('AUTO_APPROVED','APPROVED','SCHEDULED')

UPDATE interaction_responses
  SET status = 'IN_PROGRESS', updated_at = now()
  WHERE id = :responseId
    AND status IN ('AUTO_APPROVED','APPROVED','SCHEDULED')

INSERT INTO interaction_response_attempts (...)

COMMIT
```

If the `UPDATE` matched zero rows, another worker has already claimed the response; the job exits without an external call.

---

# 55. Unknown External State

If the external request outcome cannot be determined:

```text
IN_PROGRESS
      ↓
UNKNOWN
```

Never immediately retry.

**Outbound response unknown state (new in v0.9.0):**

If the Graph API call for an outbound response does not return a definitive outcome:

```text
interaction_responses.status = 'UNKNOWN'
```

The response is then eligible for push or pull reconciliation (§142.7).

---

# 56. Publication Reconciliation

The reconciliation service investigates:

```text
UNKNOWN
STALE IN_PROGRESS
```

records.

If the external publication exists:

```text
PUBLISHED
```

Otherwise:

```text
RETRY_ELIGIBLE
```

### 56.1 Reconciliation Scheduling and Threshold Boundary

The system guarantees that `UNKNOWN` outcomes and stale `IN_PROGRESS` publication attempts are eligible for reconciliation according to the publication persistence and state-machine contract. Reconciliation must not depend on an assumption that an uncertain external outcome can be resolved by an ordinary publication retry alone.

The concrete reconciliation schedule and stale threshold are configuration and implementation parameters. This includes, where applicable:

```text
reconciliation interval
stale IN_PROGRESS threshold
batch size / processing limit
retry or backoff parameters
maximum reconciliation work per run
```

These values must be selected and operated so that stale attempts are eventually examined without creating unbounded external API pressure. The exact cron interval, threshold, batching strategy, and operational limits are intentionally not fixed by the DB model and may evolve without changing the persistence architecture.

The implementation must preserve the invariant that:

```text
UNKNOWN or stale IN_PROGRESS
        ↓
eligible for reconciliation
        ↓
external state investigated
        ↓
PUBLISHED or retry-eligible outcome
```

---

# 57. Publication State Machine

```text
SCHEDULED
   ↓
RESERVED
   ↓
IN_PROGRESS
   ├── SUCCESS → PUBLISHED
   ├── TRANSIENT ERROR → RETRY
   ├── PERMANENT ERROR → FAILED
   └── UNKNOWN → RECONCILIATION
```

---

# 58. External API Principle

The system must never assume:

```text
HTTP request failed
=
external action did not occur
```

Likewise:

```text
HTTP request succeeded
=
all downstream processing is complete
```

External state must be explicitly reconciled when required.

---

# 59. Image Policy Engine

The `ImagePolicyEngine` evaluates:

- source domain;
- rights state;
- MIME type;
- dimensions;
- file size;
- format;
- EXIF;
- source-specific rules.

Interface:

```typescript
interface ImagePolicyEngine {
  evaluate(image: ImageCandidate): Promise<ImagePolicyResult>;
}
```

---

# 60. Image Domain Rules

Configurable:

```text
blocked_domains
allowed_domains
minimum_width
minimum_height
maximum_file_size
allowed_mime_types
strip_exif
```

---

# 61. EXIF Handling

If an image is legally eligible for processing and is stored or transformed by the system, EXIF metadata may be stripped to avoid unintentionally propagating metadata.

This must not be interpreted as changing ownership or rights.

---

# 62. Image Fallback

If an image cannot safely be used:

```text
image publication
      ↓
not eligible
      ↓
link post
```

The system must retain the original source URL.

---

# 63. Content Package

Before moderation, the system creates a complete publication candidate:

```text
PublicationCandidate
├── title
├── caption
├── summary
├── source_url
├── attribution
├── image
├── category
├── entities
├── validation
└── trace_id
```

---

# 64. Publication Candidate Immutability

Once approved, the candidate should be versioned.

If the caption is later changed:

```text
version 1
version 2
```

The audit history must preserve both.

---

# 65. Content Versioning

```text
content_versions
----------------
id
content_id
version
title
summary
caption
created_by
created_at
```

---

# 66. Moderation Workflow

```text
PENDING
   │
   ├── APPROVE
   │
   ├── REJECT
   │
   ├── EDIT
   │
   └── ARCHIVE
```

Edited content returns to validation.

---

# 67. Edit → Validate Rule

Every editorial modification that affects publication content must trigger:

```text
EDIT
 ↓
VALIDATE
 ↓
MODERATION
```

An editor cannot bypass mandatory validation simply by editing an approved item.

---

# 68. Preview Safety

The preview shown to administrators must represent the actual publication payload as closely as possible.

The system should not display a preview that differs materially from what the publisher receives.

---

# 69. Meta Publisher

The Meta integration consists of:

```text
MetaPublisherAdapter
MetaCredentialService
MetaErrorMapper
MetaRateLimiter
MetaPublicationReconciler
```

**In v0.9.0 the Meta integration is extended with the following components:**

```text
MetaWebhookSignatureVerifier
MetaWebhookEnvelopeValidator
MetaWebhookChangeExtractor
MetaInteractionAdapter
MetaInteractionRateLimiter
MetaResponseReconciler
```

The publisher adapter is **outbound only**. The webhook ingress and processing components are separate and do not share code with the publisher adapter, other than the `MetaErrorMapper` for error categorization.

---

# 70. Meta API Version

The API version is configuration-driven.

```text
META_GRAPH_API_VERSION
```

The integration must be tested before production upgrades.

The webhook payload schema is version-tolerant: unrecognized fields and unrecognized `value` shapes are skipped, not treated as fatal errors. See §141.

---

# 71. Meta Credentials

Secrets:

```text
META_APP_ID
META_APP_SECRET
META_PAGE_ID
META_PAGE_ACCESS_TOKEN
```

must never be committed to source control.

**In v0.9.0, credentials are stored encrypted at rest.** See §143.

Encryption keys are supplied via:

```text
META_CREDENTIAL_ENCRYPTION_KEYS              (JSON map of version -> base64 key)
META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION    (integer)
```

The webhook verify token uses a **distinct** encryption key:

```text
WEBHOOK_TOKEN_ENCRYPTION_KEY                 (base64 key)
```

The two secrets must not share key material.

---

# 72. Credential Health

States:

```text
VALID
EXPIRING
INVALID
UNKNOWN
```

Invalid credentials cause:

```text
publishing pause
+
admin alert
+
audit record
```

**Publishing pause implementation (clarified in v0.9.0):**

The pause is enforced by the publication scheduler, not by introducing a new `publications.status` value and not by deactivating the destination.

```text
PublicationScheduler.enqueue()
      ↓
CredentialHealthReport.overall === 'INVALID'?
      ↓ yes                          ↓ no
Skip enqueue (publications         Enqueue content.publish
record remains SCHEDULED)
```

When the credential is restored to `VALID`, the scheduler automatically picks up any `SCHEDULED` records that were deferred. No manual unblock step is required.

The `MetaPublisherAdapter` re-checks the credential immediately before the external call. If the credential is no longer valid at that moment, the attempt fails with `error_category = 'CREDENTIAL_INVALID'` and the publication transitions to `RECONCILIATION`.

---

# 73. Meta Error Classification

```text
AUTHENTICATION_ERROR
AUTHORIZATION_ERROR
RATE_LIMIT
NETWORK_ERROR
TEMPORARY_SERVER_ERROR
INVALID_REQUEST
CONTENT_REJECTED
UNKNOWN
```

Retry policy depends on error class.

**The same canonical classification is used by:**

- the outbound publication adapter
- the outbound interaction response adapter
- the credential refresh flow
- the webhook processing flow (for downstream Graph API calls, which are rare)

---

# 74. Publication Rate Limits

Publishing is governed by:

```text
per-destination limit
global limit
daily limit
minimum interval
```

The values are configurable.

**Interaction response rate limits (new in v0.9.0):**

Outbound responses are governed by a **separate** rate limiter because the Meta BUC that governs `pages_manage_engagement` is distinct from `pages_manage_posts`:

```text
interaction_response.max_per_hour_per_destination
interaction_response.min_interval_seconds
interaction_response.global_max_per_hour
```

These limits are enforced at three points:

1. **Policy engine** — coarse pre-filter based on recent response volume.
2. **Queue enqueue** — the `webhook.respond` job is not created if the limit is exhausted; the response remains `SCHEDULED` with an adjusted `scheduled_at`.
3. **Adapter** — the `MetaInteractionRateLimiter` re-checks the limit immediately before the external call.

---

# 75. Global Kill Switch

```text
publication.enabled = false
```

When activated:

- ingestion continues;
- processing continues;
- moderation continues;
- scheduling continues;
- external publishing stops.

**In v0.9.0 the kill switch applies to the outbound pipeline only.** The inbound webhook pipeline remains operational:

- webhook ingress continues;
- webhook processing continues;
- interaction materialization continues;
- outbound responses pause automatically because the `webhook.respond` queue respects `publication.enabled = false` as an enqueue gate.

An additional `responses.enabled` flag allows the outbound response pipeline to be disabled independently:

```text
responses.enabled = false
```

When `responses.enabled = false`, `webhook.respond` and `webhook.respond.reconcile` do not enqueue work. Inbound processing continues normally.

---

# 76. Configuration Service

Components:

```text
ConfigService
DynamicConfigCache
ConfigValidator
ConfigAuditLog
```

---

# 77. Configuration Cache

Default TTL:

```text
30–60 seconds
```

Critical configuration changes may trigger immediate cache invalidation.

**In v0.9.0, the credential cache is a separate in-memory cache** with a short TTL (default 45 seconds) to avoid repeated AES-GCM decryption on the publication hot path. The cache is invalidated when:

- the credential is rotated;
- the credential is invalidated;
- the credential's `last_rotation_at` changes.

See §143.5.

---

# 78. Configuration Audit

Every change records:

```text
key
old_value
new_value
user
reason
timestamp
IP
```

**Additionally, the following operations produce entries in `audit_logs` or `config_audit_log` in v0.9.0:**

- webhook subscription creation
- webhook subscription status change
- verify token rotation
- credential rotation
- credential invalidation
- interaction response moderation decision
- interaction response execution
- interaction response reconciliation

---

# 79. Security Model

Security principles:

```text
least privilege
minimal exposure
secret isolation
defense in depth
auditability
fail closed
```

**v0.9.0 additions:**

- Webhook signature verification is mandatory and fail-closed. An invalid signature never produces a `webhook_events` row.
- The webhook envelope must pass a Zod schema check before persistence.
- Provider credentials and the webhook verify token are encrypted with **distinct** keys.
- Credential plaintext never appears in logs, audit records, error messages, or extended caches.
- The `ProviderCredentialService.getCredential()` method returns plaintext only for the duration of a single operation; the caller must not retain it.

---

# 80. Admin Access

Recommended:

```text
HTTPS
VPN or Cloudflare Access
IP allowlist
rate limiting
secure cookies
MFA-ready architecture
```

---

# 81. Roles

```text
VIEWER
EDITOR
PUBLISHER
ADMIN
```

Permissions are explicit.

**The `PUBLISHER` role in v0.9.0 also authorizes interaction response moderation** (approve, reject, edit) in addition to publication moderation.

---

# 82. Audit Architecture

Audit records are append-oriented.

The platform uses a central `audit_logs` persistence table for cross-domain operational and business audit events. It complements dedicated history and audit structures such as `config_audit_log`, `moderation_actions`, `publication_attempts`, and `publication_reconciliations`; it does not replace them.

Important actions include:

```text
authentication
configuration
source changes
moderation
publication
credential changes
kill switch
story merge/split
manual overrides
```

**In v0.9.0 the following are added to the central audit trail:**

- webhook subscription lifecycle changes
- webhook verify token rotation
- provider credential rotation
- provider credential invalidation
- interaction response moderation decisions
- interaction response external execution
- interaction response reconciliation outcomes

The central audit record contains the actor where applicable, action, entity type, optional entity identifier, changes, metadata, and creation timestamp. The `entity_id` field is intentionally not a polymorphic foreign key.

---

# 83. Audit Integrity

Audit records must not be silently overwritten.

The central `audit_logs` table is append-only at the application level. Application code must not update or delete existing audit records.

If corrections are required, a new audit event should be created.

The same rule applies to the domain-specific history tables introduced in v0.9.0:

```text
webhook_deliveries
interaction_response_attempts
interaction_response_reconciliations
```

---

# 84. Database Schema — Core

The canonical persistence model is defined by `DATABASE_SCHEMA_CONTRACT.md` **v1.2**.

DB v1 contains **44 persistence tables**, organized into six categories.

### Core logical model (15 tables)

Defined by the DB v1 Logical Model Specification v1.0.

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

### Supporting platform persistence (18 tables)

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

### Inbound event persistence (4 tables) — new in v1.1

```text
webhook_subscriptions
webhook_events
webhook_deliveries
external_interactions
```

### Inbound health companion (1 table) — new in v1.2

```text
webhook_subscription_health
```

### Provider credentials and interaction response (5 tables) — new in v1.1

```text
provider_credentials
interaction_responses
interaction_response_attempts
interaction_moderation_actions
interaction_response_reconciliations
```

### Platform pattern (1 table) — new in v1.1

```text
outbox_jobs
```

The following legacy source-ingestion tables are not part of DB v1 and must not be recreated:

```text
source_cursors
source_health
```

Their responsibilities are replaced by endpoint-specific state and endpoint health.

For the full physical schema, see `DATABASE_SCHEMA_CONTRACT.md` v1.2.

---

# 84.1 Source Persistence Model

(Carried forward from v0.8.1 — unchanged.)

The persisted source model contains logical source identity only:

```text
sources
-------
id
name
status
reputation_state
priority
safety_limits
created_at
updated_at
```

`type` and `url` do not belong to `sources`. A source may own multiple technical endpoints.

---

# 84.2 SourceEndpoint Persistence Model

(Carried forward from v0.8.1 — unchanged.)

```text
source_endpoints
----------------
id
source_id
representation
capabilities
url
status
next_poll_at
state_version
state
created_at
updated_at
```

Unique business identity: `(source_id, url)`.

Endpoint state is JSONB and is discriminated by `kind`. `state_version` is the optimistic concurrency version.

---

# 84.3 SourceEndpointHealth Persistence Model

(Carried forward from v0.8.1 — unchanged.)

```text
source_endpoint_health
----------------------
endpoint_id
consecutive_failures
last_success_at
last_failure_at
last_error_category
last_error_message
items_today
updated_at
```

---

# 84.4 Discovery and Provenance Persistence

(Carried forward from v0.8.1 — unchanged.)

```text
SourceEndpoint
      ↓
DiscoveryObservation
      ↓
DiscoveredResource
```

---

# 84.5 Destination Model

(Carried forward from v0.8.1 — unchanged.)

```text
destinations
------------
id
name
type
external_id
is_active
created_at
updated_at
```

Unique business identity: `(type, external_id)`.

---

# 84.6 Central Audit Log Model

(Carried forward from v0.8.1 — unchanged.)

```text
audit_logs
----------
id
actor_user_id
action
entity_type
entity_id
changes
metadata
created_at
```

---

# 84.7 Webhook Subscription Model — new in v1.1

```text
webhook_subscriptions
---------------------
id
destination_id
provider
fields
verify_token_encrypted
verify_token_key_version
status
last_verified_at
last_rotated_at
created_at
updated_at
```

Unique business identity: `(destination_id, provider)`.

The verify token is encrypted with `WEBHOOK_TOKEN_ENCRYPTION_KEY`, which is distinct from the Meta credential encryption key.

See §140.2 for the ingress verification flow.

---

# 84.8 Webhook Subscription Health Model — new in v1.2

```text
webhook_subscription_health
---------------------------
subscription_id
consecutive_failures
consecutive_successes
last_success_at
last_failure_at
last_error_category
last_error_message
events_today
updated_at
```

Strict 1:1 extension of `webhook_subscriptions`. Mirrors the `source_endpoint_health` pattern. Storage now, use later — health metrics consumption is deferred (D-009).

---

# 84.9 Webhook Event Model — new in v1.1

```text
webhook_events
--------------
id
provider
destination_id
object_type
external_object_id
field
idempotency_key
raw_payload
raw_body_hash
signature_verified
trace_id
status
received_at
processed_at
updated_at
```

Unique business identity: `idempotency_key`.

`raw_payload` and `raw_body_hash` are immutable after insert. `signature_verified` is always `true` under fail-closed ingress.

---

# 84.10 Webhook Delivery Model — new in v1.1

```text
webhook_deliveries
------------------
id
webhook_event_id
attempt_number
status
started_at
finished_at
error_category
error_message
worker_id
created_at
```

Unique business identity: `(webhook_event_id, attempt_number)`.

Business-history table. Not a generic worker execution log.

---

# 84.11 External Interaction Model — new in v1.1

```text
external_interactions
---------------------
id
webhook_event_id
destination_id
publication_id
interaction_type
external_interaction_id
parent_external_id
actor_external_id
actor_display_name
content
permalink
occurred_at
raw_metadata
created_at
updated_at
```

Unique business identity: `(interaction_type, external_interaction_id)`.

The FK `publication_id → publications.id` is added by the deferred migration step (see §84.14).

---

# 84.12 Provider Credential Model — new in v1.1

```text
provider_credentials
--------------------
id
scope
destination_id
provider
credential_type
encrypted_value
encryption_key_version
status
expires_at
last_validated_at
last_rotation_at
rotation_reason
created_at
updated_at
```

Unique business identity:

```text
(provider, credential_type, scope,
 COALESCE(destination_id, '00000000-...-0000'::uuid))
```

The `COALESCE` expression allows APP-scope rows (where `destination_id IS NULL`) to participate in the unique index without PostgreSQL treating NULLs as distinct.

---

# 84.13 Interaction Response Models — new in v1.1

```text
interaction_responses
interaction_response_attempts
interaction_moderation_actions
interaction_response_reconciliations
```

See §142 for the interaction response lifecycle and the corresponding state machine.

---

# 84.14 Transactional Outbox Model — new in v1.1

```text
outbox_jobs
-----------
id
queue_name
job_id
payload
status
attempts
last_attempt_at
last_error
dispatched_at
trace_id
created_at
```

Unique business identity: `job_id`.

The `outbox_jobs` table has **no foreign keys**. This is deliberate. See §144.

---

# 84.15 Deferred foreign key

The `external_interactions.publication_id → publications.id` foreign key is added by the **deferred migration step** (`0009` in the current migration set) because the `publications` table is created in a later migration than `external_interactions`. The column itself exists in the initial `external_interactions` creation; only the FK constraint is deferred.

The `content_items.current_version_id ↔ content_versions.content_item_id` mutual FK is resolved within a single migration (`0005`) via a Drizzle lazy callback. No separate deferred FK migration is required for that pair.

---

# 85. Story Membership

Story membership is explicitly many-to-many. A content item may participate in multiple stories, and a story may contain multiple content items.

The persisted membership model is:

```text
story_members
-------------
id
story_id
content_item_id
relevance_score
membership_type
assignment_method
added_at
```

Unique business identity: `(story_id, content_item_id)`.

---

# 86. Publication Candidate

```text
publication_candidates
----------------------
id
content_id
story_id
version
title
caption
summary
source_url
image_id
validation_status
created_at
```

---

# 87. AI Usage

```text
ai_usage
--------
id
content_id
provider
model
operation
input_tokens
output_tokens
estimated_cost
created_at
```

The cost currency or unit is an application-level decision (D-006).

---

# 88. Notifications

Notifications may be generated for:

```text
credential failure
system failure
queue backlog
publication failure
AI budget threshold
source failure
```

**v0.9.0 additions:**

```text
webhook subscription verification failure
webhook signature verification failure (aggregated)
webhook processing dead-letter
credential expiring
credential rotated
credential refresh failed
credential invalid
interaction response moderation queue backlog
interaction response execution failure
interaction response reconciliation required
outbox dispatch failure
outbox cleanup anomaly
```

Notification severity is domain-validated and follows the pattern established in v0.8.1:

- `INFO` for routine lifecycle events (rotation success, cleanup completion)
- `WARNING` for degradation (refresh failure, response backlog)
- `CRITICAL` for outages (credential invalid, dead-letter accumulation)

---

# 89. Observability

The system exposes:

```text
logs
metrics
traces
health
```

---

# 90. Metrics

Core:

```text
sources_checked_total
sources_failed_total
content_discovered_total
content_rejected_total
content_duplicate_total
content_clustered_total
content_published_total
content_publish_failed_total
publication_unknown_total
publication_reconciled_total
facebook_api_errors_total
facebook_rate_limit_total
ai_requests_total
ai_failures_total
```

**v0.9.0 additions:**

```text
webhook_received_total
webhook_signature_failed_total
webhook_persisted_total
webhook_processed_total
webhook_dead_letter_total
external_interactions_created_total
external_interactions_updated_total
external_interactions_skipped_stale_total
interaction_responses_created_total
interaction_responses_responded_total
interaction_responses_failed_total
interaction_responses_reconciled_total
outbox_jobs_enqueued_total
outbox_jobs_dispatched_total
outbox_jobs_failed_total
outbox_jobs_recovered_total
outbox_cleanup_deleted_total
credential_rotated_total
credential_refresh_failed_total
credential_invalid_total
```

---

# 91. Queue Metrics

```text
queue_depth
queue_wait_time
job_processing_duration
job_failure_rate
retry_count
stale_job_count
```

---

# 92. Business Metrics

```text
relevance_rate
duplicate_rate
moderation_accept_rate
publication_success_rate
source_reputation
average_processing_time
```

**v0.9.0 additions:**

```text
interaction_response_accept_rate
interaction_response_auto_respond_rate
interaction_response_reconcile_rate
webhook_end_to_end_latency_ms
outbox_dispatch_latency_ms
```

---

# 93. Health Endpoints

```text
GET /health
GET /ready
GET /metrics
```

`/ready` verifies required dependencies:

- PostgreSQL connectivity
- Redis connectivity
- outbox dispatcher liveness
- at least one active webhook subscription (if inbound is enabled)

---

# 94. Backup

PostgreSQL:

```text
daily backup
```

Retention:

```text
7–30 days
```

Backups must be external to the primary VPS.

---

# 95. Redis Recovery

If Redis is lost:

```text
restore Redis
   ↓
system.rebuild
   ↓
inspect PostgreSQL (including outbox_jobs)
   ↓
repopulate queues
```

The database remains authoritative.

---

# 96. Disaster Recovery

Initial targets:

```text
RPO = 24 hours
RTO = 4 hours
```

These can be improved later.

---

# 97. Migration Strategy

Production schema changes use:

```text
EXPAND
MIGRATE
SWITCH
CONTRACT
```

Destructive operations are delayed until all application instances no longer depend on the old schema.

**In v0.9.0, the following migration invariants apply:**

- The `0000` migration creates `pgcrypto` and never re-declares it.
- The v1.1 additions are an additive expansion over v1.0. No v1.0 table is modified.
- The v1.2 additions are additive or documentation-only. No v1.1 table is modified.
- The `external_interactions.publication_id` FK is added in a deferred migration because the target table is created later.
- The `content_items.current_version_id ↔ content_versions.content_item_id` mutual FK is resolved within a single migration via a lazy callback.

---

# 98. CI Migration Validation

CI must test:

```text
clean database
↓
all migrations
↓
schema validation
↓
seed
↓
application tests
```

Upgrade testing should additionally verify:

```text
previous schema
+
new application
```

where rolling deployment compatibility is required.

---

# 99. Testing

Test layers:

```text
unit
integration
contract
end-to-end
failure/recovery
```

---

# 100. Required Failure Tests

**Outbound pipeline (carried forward from v0.8.1):**

```text
malformed RSS
invalid charset
oversized response
duplicate URL
near duplicate
story merge
story split
Redis loss
PostgreSQL restart
worker crash
Meta 401
Meta 403
Meta 429
Meta 500
network timeout
unknown publication outcome
AI provider failure
AI quota exceeded
invalid image
unknown image rights
expired credentials
```

**Inbound webhook pipeline (new in v0.9.0):**

```text
invalid webhook signature (rejected at HTTP boundary)
malformed webhook envelope (rejected at HTTP boundary)
duplicate webhook event (idempotency key conflict)
out-of-order webhook event (stale occurred_at skipped)
webhook with unsupported field (skipped, not fatal)
webhook with malformed value (partial failure, other changes still processed)
webhook persisted but never enqueued (outbox recovery path)
webhook PROCESSING state abandoned (stale recovery)
webhook dead-letter after max attempts
webhook processing partial failure (some changes succeed, some fail)
```

**Interaction response pipeline (new in v0.9.0):**

```text
response policy → AUTO_RESPOND
response policy → MODERATION_REQUIRED
response policy → IGNORE (reaction)
response template render → placeholder substitution
response template render → missing placeholder → fail-closed
response moderation → approve → queued
response moderation → reject → terminal
response moderation → edit → revalidation
response moderation → edit → validation fail → MODERATION_REQUIRED
Meta respond → 200 → RESPONDED
Meta respond → 401 → FAILED + credential invalidate
Meta respond → 403 → FAILED
Meta respond → 429 → RETRY + Retry-After respected
Meta respond → 500 → RETRY
Meta respond → network timeout → UNKNOWN
Meta respond → UNKNOWN → push reconciliation → RESPONDED
Meta respond → UNKNOWN → pull reconciliation → RESPONDED
Meta respond → UNKNOWN → pull reconciliation → RETRY_ELIGIBLE
Meta respond → duplicate comment_id → idempotent
response rate limit exceeded at policy → MODERATION_REQUIRED
response rate limit exceeded at enqueue → QUEUED with adjusted scheduled_at
response rate limit exceeded at adapter → RETRY + backoff
concurrent response attempt → only one wins (atomic status guard)
```

**Credential lifecycle (new in v0.9.0):**

```text
credential decryption with wrong key version (fail-closed)
credential decryption with tampered ciphertext (fail-closed)
credential decryption with mismatched AAD (fail-closed)
APP-scope credential with destination_id set (rejected by CHECK)
DESTINATION-scope credential without destination_id (rejected by CHECK)
credential rotation with concurrent writers (last-write-wins on rotated value)
credential cache invalidation on rotation
credential expiry scan finds EXPIRING credentials
credential becomes INVALID → scheduler skips → publications remain SCHEDULED
credential restored to VALID → scheduler picks up deferred publications
```

**Outbox (new in v0.9.0):**

```text
enqueue inside a transaction (visible only after commit)
enqueue inside a transaction that rolls back (no orphaned row)
claim via FOR UPDATE SKIP LOCKED (two dispatchers do not collide)
dispatcher crash between BullMQ add and DISPATCHED update (recovery safe)
stale DISPATCHING recovery (returns to PENDING)
BullMQ jobId deduplication on recovery (no duplicate job)
cleanup deletes only DISPATCHED rows
cleanup respects retention window
system.rebuild recovers PENDING and stale DISPATCHING rows
system.rebuild does not duplicate outbox jobs
```

---

# 101. End-to-End Test

Canonical outbound test:

```text
RSS
 ↓
Discovery
 ↓
Normalization
 ↓
Relevance
 ↓
Entity extraction
 ↓
Deduplication
 ↓
Story clustering
 ↓
Conflict resolution
 ↓
Processing
 ↓
Validation
 ↓
Image policy
 ↓
Moderation
 ↓
Scheduling
 ↓
Publication mock
 ↓
Audit
```

**Canonical inbound test (new in v0.9.0):**

```text
Meta webhook POST
 ↓
Signature verify
 ↓
Zod envelope validate
 ↓
Single transaction: webhook_events + outbox_jobs
 ↓
HTTP 200 OK
 ↓
OutboxDispatcher claims PENDING
 ↓
BullMQ add webhook.process
 ↓
webhook.process claims event
 ↓
Payload parse
 ↓
external_interactions upsert (monotonic)
 ↓
webhook_events.status = PROCESSED
 ↓
Response policy engine
 ↓
AUTO_RESPOND or MODERATION_REQUIRED
 ↓
(moderation → APPROVE)
 ↓
webhook.respond enqueue
 ↓
MetaInteractionAdapter call
 ↓
interaction_responses.status = RESPONDED
 ↓
Push reconciliation: own response → feed webhook
 ↓
webhook.process matches to interaction_responses
 ↓
verify idempotency: no duplicate response
 ↓
Audit
```

---

# 102. Performance Requirements

Initial target:

```text
20–50 sources
hundreds of discovered items/day
5–10 publications/day
```

The system should maintain stable operation under these loads on a small VPS.

**Inbound target (new in v0.9.0):**

```text
up to 1000 webhook events/day
up to 200 inbound interactions/day
up to 100 outbound responses/day
```

The webhook ingress must respond to Meta within **200 ms** on the hot path. Redis latency is not on the hot path (the outbox pattern moves Redis off the ingress critical path).

---

# 103. Scalability

Scaling path:

```text
Single worker
   ↓
Multiple workers
   ↓
Separate processing workers
   ↓
Dedicated queue workers
   ↓
Multiple application instances
```

The domain model should not need to change.

**Outbox dispatcher scaling (new in v0.9.0):**

Multiple `OutboxDispatcher` instances may run concurrently. The `FOR UPDATE SKIP LOCKED` claim pattern (§144.4) guarantees that no two dispatchers claim the same row.

---

# 104. Backpressure

When processing queues become overloaded, scheduler policy may reduce endpoint polling or defer lower-priority endpoints rather than allowing unlimited backlog. Endpoint scheduling state remains authoritative in PostgreSQL.

**Inbound backpressure (new in v0.9.0):**

The webhook ingress does **not** apply backpressure to Meta. The ingress responds with HTTP 200 after durable persistence and outbox enqueue. If the `webhook.process` queue is saturated, the `outbox_jobs` table becomes the buffer: rows accumulate as `PENDING` and are dispatched when capacity returns.

The `webhook.process` queue is configured with a **higher priority** than the `content.*` queues because Meta retries have a bounded window and inbound interactions benefit from low latency.

The `webhook.respond` queue is configured with **lower priority** than `webhook.process` because outbound responses may legitimately be delayed.

---

# 105. Storage Policy

Large article content should remain in PostgreSQL or object storage.

Queue payloads contain IDs rather than full documents.

Example:

```json
{
  "contentId": "cnt_123"
}
```

**v0.9.0 additions:**

```json
{ "webhookEventId": "..." }
{ "responseId": "..." }
{ "credentialId": "..." }
```

`outbox_jobs.payload` follows the same rule: identifiers only. It must never contain a full document, a raw payload, or a secret.

---

# 106. Idempotency

Every meaningful job must have an idempotency key.

Examples:

```text
content.normalize:{contentId}
content.classify:{contentId}
content.publish:{contentId}:{destinationId}
```

**v0.9.0 additions:**

```text
webhook.process:{webhookEventId}
webhook.respond:{responseId}
webhook.respond.reconcile:{responseId}
meta.credential.refresh:{credentialId}
```

The webhook ingress uses a **three-layer** idempotency model:

1. **HTTP receipt** — `webhook_events.idempotency_key` (SHA-256 of the body hash).
2. **Job** — `webhook.process:{webhookEventId}` (BullMQ deduplication).
3. **Domain** — `(interaction_type, external_interaction_id)` unique constraint and monotonic `occurred_at`.

---

# 107. Exactly-Once Reality

The system must not claim guaranteed exactly-once external execution.

The practical reliability model is:

```text
at-least-once processing
+
idempotent state
+
locking
+
reconciliation
```

The outbox pattern strengthens the guarantee: every durable side effect produces an outbox row that is guaranteed to be enqueued eventually, and every outbox row produces a BullMQ job that is deduplicated by deterministic `job_id`.

---

# 108. Content Retention

Suggested:

```text
content:
long-term

audit:
>= 1 year

logs:
30–90 days

publication attempts:
90+ days

queue history:
7–30 days
```

All retention periods should be configurable.

**v0.9.0 additions:**

```text
webhook_events.raw_payload:
30 days (large payloads)

webhook_events (metadata):
365 days (audit)

webhook_deliveries:
90+ days

external_interactions:
long-term (external facts)

interaction_responses:
long-term

interaction_response_attempts:
90+ days

outbox_jobs (DISPATCHED):
7 days (default OUTBOX_CLEANUP_RETENTION_DAYS)
```

The `outbox_jobs` cleanup job is the only automatic retention mechanism applied to the outbox. `PENDING`, `DISPATCHING`, and `FAILED` rows are never deleted by cleanup.

---

# 109. Source Lifecycle

(Carried forward from v0.8.1 — unchanged.)

A logical source may be:

```text
ACTIVE
PAUSED
DISABLED
```

Source reputation is tracked independently:

```text
VERIFIED
NEUTRAL
FLAGGED
```

---

# 110. Source Onboarding

(Carried forward from v0.8.1 — unchanged.)

Adding a logical source and configuring its technical access points are separate steps.

**Webhook subscription onboarding (new in v0.9.0):**

A webhook subscription is onboarded separately from a source. The onboarding flow is:

```text
Destination exists (Meta Page)
      ↓
Generate verify token (32 random bytes, base64)
      ↓
Store encrypted in webhook_subscriptions
      ↓
Register webhook URL with Meta (manual, admin UI)
      ↓
Meta sends hub.challenge GET
      ↓
Ingress validates hub.verify_token
      ↓
webhook_subscriptions.last_verified_at = now()
      ↓
status = ACTIVE
```

Verify token rotation is a **manual** administrative operation that must produce an `audit_logs` entry.

---

# 111. Source Quality Warm-Up

(Carried forward from v0.8.1 — unchanged.)

**Webhook subscription warm-up (new in v0.9.0):**

A new webhook subscription begins in `PAUSED` status. It must be explicitly activated after a bounded test:

```text
PAUSED
   ↓
admin sends test payload
   ↓
signature verifies, event persists, worker processes
   ↓
admin confirms expected interaction materialized
   ↓
status = ACTIVE
```

A subscription is not automatically trusted merely because it was created.

---

# 112. Editorial Rules

(Carried forward from v0.8.1 — unchanged.)

**v0.9.0 additions** to `system_config`:

```text
interaction_response_rules       (policy rule definitions)
interaction_response_templates   (response text templates)
interaction_response.max_per_hour_per_destination
interaction_response.min_interval_seconds
interaction_response.global_max_per_hour
```

See D-010 and D-011 in the database contract for the deferred decision to keep these in `system_config` rather than introducing dedicated tables.

---

# 113. Manual Override

(Carried forward from v0.8.1 — unchanged.)

**v0.9.0 additions:**

Authorized users may override:

```text
interaction response decision (force AUTO_RESPOND or MODERATION_REQUIRED)
interaction response body
interaction response template selection
```

All overrides are audited.

---

# 114. Admin Preview

The preview must show:

```text
Facebook caption
image
source
link
publication time
timezone
story
relevance
validation state
```

**Inbound interaction preview (new in v0.9.0):**

The admin interface must show, for a pending interaction response:

```text
original interaction content (comment text, mention)
actor display name
destination
publication (if known)
selected template
rendered response body
validation state
policy decision and matched rules
prior moderation actions on this response
```

---

# 115. Publishing Calendar

(Carried forward from v0.8.1 — unchanged.)

**Inbound queue (new in v0.9.0):**

A separate admin view shows the `MODERATION_REQUIRED` interaction response queue. It is not merged with the publication calendar because the two have different throughput, urgency, and lifecycle characteristics.

---

# 116. Notification Strategy

(Carried forward from v0.8.1 — unchanged.)

**v0.9.0 specifics for the new notification types:**

- `credential_expiring` — sent once when the credential enters the `EXPIRING` state (7 days before expiry).
- `credential_refresh_failed` — sent on each failed refresh, capped at once per day.
- `credential_invalid` — sent once while the credential remains `INVALID`.
- `credential_rotated` — informational, one per successful rotation.
- `webhook_signature_failed_total` — aggregated; the notification is sent only when the rate exceeds a configured threshold in a rolling window.
- `webhook_dead_letter_total` — sent immediately on the first dead-letter event; subsequent events are aggregated.
- `outbox_dispatch_failure` — sent when a row transitions to `FAILED`.

---

# 117. Cost Governance

(Carried forward from v0.8.1 — unchanged.)

---

# 118. Feature Flags

(Carried forward from v0.8.1 — unchanged, with the following additions.)

**v0.9.0 additions:**

```text
ENABLE_WEBHOOK_INGRESS
ENABLE_INTERACTION_RESPONSE
ENABLE_AUTO_RESPOND
ENABLE_OUTBOX_DISPATCHER
```

`ENABLE_AUTO_RESPOND` gates only the automatic path. When `false`, all interactions route to `MODERATION_REQUIRED` regardless of policy.

---

# 119. Staging Environment

(Carried forward from v0.8.1 — unchanged.)

**v0.9.0 addition:** staging must use a **separate verify token** and a **separate Meta webhook endpoint** (or a tunnel) so that production webhook traffic is never received by the staging environment.

---

# 120. Production Deployment

Deployment:

```text
backup
↓
pull/build images
↓
run migrations
↓
start services
↓
health checks
↓
queue verification (including outbox dispatcher)
↓
publishing verification
↓
webhook verification
```

---

# 121. Rollback

Rollback should prefer:

```text
previous application image
+
forward-compatible database
```

rather than destructive schema rollback.

---

# 122. Graceful Shutdown

Workers must:

```text
stop new jobs
finish active jobs where possible
close database connections
close Redis connections
exit
```

**Outbox dispatcher specifics (new in v0.9.0):**

The dispatcher must **stop claiming new rows** before shutting down. Any row already claimed but not yet dispatched remains in `DISPATCHING`. On the next startup, the recovery path restores it to `PENDING`, and BullMQ's `jobId` deduplication guarantees no duplicate job is created.

---

# 123. Operational Runbooks

(Carried forward from v0.8.1 — unchanged.)

**v0.9.0 additions:**

```text
webhook signature verification failure
webhook dead-letter accumulation
outbox dispatch stuck in DISPATCHING
outbox dispatch PENDING backlog
credential rotation failure
credential invalid recovery
interaction response backlog
interaction response reconciliation stuck
```

---

# 124. Security Incident Procedure

(Carried forward from v0.8.1 — unchanged.)

**v0.9.0 additions:**

```text
1. Activate publishing kill switch AND responses.enabled = false.
2. Revoke credentials externally.
3. Rotate secrets, including the webhook verify token.
4. Review audit logs.
5. Review publication attempts AND interaction_response_attempts.
6. Review webhook_events for unexpected sources.
7. Restore service only after validation.
```

---

# 125. Architecture Decision — Database First

(Carried forward from v0.8.1 — unchanged.)

```text
PostgreSQL
    ↓
What should happen?

Redis/BullMQ
    ↓
What should execute now?
```

The outbox pattern makes this principle concrete: the intent to enqueue is persisted in PostgreSQL before any Redis interaction.

---

# 126. Architecture Decision — Fail Closed

(Carried forward from v0.8.1 — unchanged.)

```text
REVIEW
```

rather than:

```text
PUBLISH
```

**v0.9.0 additions:**

- Invalid webhook signature → HTTP 401, no persistence.
- Malformed webhook envelope → HTTP 400, no persistence.
- Missing placeholder in a response template → the response fails validation and returns to `MODERATION_REQUIRED`.
- Unknown credential encryption key version → decryption fails, credential is treated as `INVALID`.

---

# 127. Architecture Decision — AI Optional

(Carried forward from v0.8.1 — unchanged.)

---

# 128. Architecture Decision — External API Isolation

(Carried forward from v0.8.1 — unchanged.)

All external publishing goes through:

```text
PublisherAdapter
```

**v0.9.0 addition:** all external **interaction responses** go through:

```text
MetaInteractionAdapter
```

The publisher adapter and the interaction adapter are separate. They do not share request/response types. They use distinct rate limiters.

---

# 129. Architecture Decision — Source Independence

(Carried forward from v0.8.1 — unchanged.)

---

# 130. Architecture Decision — Story vs Content

(Carried forward from v0.8.1 — unchanged.)

---

# 131. Architecture Decision — Publication Candidate

(Carried forward from v0.8.1 — unchanged.)

---

# 132. Canonical Lifecycle

**Outbound:**

```text
SOURCE ITEM
    ↓
CONTENT ITEM
    ↓
STORY
    ↓
PUBLICATION CANDIDATE
    ↓
PUBLICATION
    ↓
EXTERNAL POST
```

**Inbound (new in v0.9.0):**

```text
EXTERNAL EVENT
    ↓
WEBHOOK EVENT (durable receipt)
    ↓
EXTERNAL INTERACTION (materialized)
    ↓
INTERACTION RESPONSE (policy decision)
    ↓
INTERACTION RESPONSE ATTEMPT (execution)
    ↓
EXTERNAL RESPONSE (Graph API result)
    ↓
PUSH RECONCILIATION (feed webhook)
    ↓
RESPONDED (terminal)
```

---

# 133. Audit Lifecycle

Every major transition creates an audit event.

**Outbound:**

```text
DISCOVERED
NORMALIZED
CLASSIFIED
CLUSTERED
APPROVED
SCHEDULED
PUBLISHING
PUBLISHED
RECONCILED
```

**Inbound (new in v0.9.0):**

```text
WEBHOOK_RECEIVED
WEBHOOK_PROCESSED
INTERACTION_MATERIALIZED
RESPONSE_DECIDED
RESPONSE_MODERATED
RESPONSE_SCHEDULED
RESPONSE_EXECUTING
RESPONSE_RESPONDED
RESPONSE_RECONCILED
```

**Credential lifecycle (new in v0.9.0):**

```text
CREDENTIAL_STORED
CREDENTIAL_VALIDATED
CREDENTIAL_ROTATED
CREDENTIAL_INVALIDATED
```

---

# 134. Final Reliability Model

```text
                 ┌───────────────┐
                 │ PostgreSQL    │
                 │ Source of     │
                 │ Truth         │
                 └───────┬───────┘
                         │
               ┌─────────▼─────────┐
               │ OutboxDispatcher  │
               └─────────┬─────────┘
                         │
               ┌─────────▼─────────┐
               │ Redis / BullMQ    │
               └─────────┬─────────┘
                         │
              ┌──────────▼──────────┐
              │ Idempotent Workers  │
              └──────────┬──────────┘
                         │
                 ┌───────▼───────┐
                 │ External API  │
                 └───────┬───────┘
                         │
                  ┌──────▼──────┐
                  │ Reconcile   │
                  └─────────────┘
```

The outbox is the **only** bridge from durable state to asynchronous execution. No durable domain transition enqueues directly to Redis.

---

# 135. Final MVP Definition

The MVP is considered production-ready when it contains:

### Infrastructure

- Node.js 22 LTS
- TypeScript 7.0
- PostgreSQL 16
- Redis 7
- BullMQ
- Docker Compose

### Ingestion

- endpoint-oriented discovery
- RSS, Atom, JSON Feed, sitemap, HTML listing, API, direct seed
- endpoint state and optimistic locking
- endpoint health
- normalization

### Intelligence

- relevance engine
- negative patterns
- entity extraction
- exact deduplication
- fuzzy deduplication
- event/product deduplication
- story clustering
- conflict resolution

### Editorial

- content validation
- moderation
- bulk moderation
- publication preview
- scheduling calendar

### Media

- image resolver
- rights status
- image policy
- validation
- fallback

### Publishing

- Meta adapter
- credential monitoring
- rate limiting
- retries
- publication locking
- idempotency
- unknown state
- reconciliation

### Inbound (new in v0.9.0)

- Meta webhook ingress
- HMAC-SHA256 signature verification (fail-closed)
- Zod envelope validation
- idempotent webhook event persistence
- transactional outbox enqueue
- `webhook.process` worker
- `external_interactions` materialization with monotonic `occurred_at`
- interaction response policy engine
- template-based response rendering
- interaction moderation workflow
- `webhook.respond` worker
- `MetaInteractionAdapter` with dedicated rate limiter
- push and pull reconciliation
- `interaction_response_attempts` history
- `interaction_response_reconciliations` history

### Credential lifecycle (new in v0.9.0)

- AES-256-GCM encryption with AAD binding
- key versioning and rotation
- distinct keys for verify token and provider credentials
- `MetaCredentialService` (get, store, rotate, invalidate, validate)
- short-TTL credential cache
- credential health states (`VALID`, `EXPIRING`, `INVALID`, `UNKNOWN`)
- publishing pause enforcement at the scheduler
- `meta.credential.refresh` queue

### Transactional outbox (new in v0.9.0)

- `outbox_jobs` table (no foreign keys)
- `OutboxRepository.enqueue(tx, job)` — the transactional entry point
- `OutboxDispatcher` with `FOR UPDATE SKIP LOCKED` claim
- two-step claim pattern (raw SQL claim + typed Drizzle read)
- stale `DISPATCHING` recovery
- `system.outbox.cleanup` queue with time-based retention
- `system.rebuild` integration for both dispatch recovery and domain-state rebuild

### Operations

- configuration service
- configuration audit
- structured logging
- metrics
- trace IDs
- health checks
- queue replay
- backups
- runbooks
- kill switch (with `responses.enabled` as a separate gate)

---

# 136. Post-MVP Features

Deferred:

```text
pgvector
semantic embeddings
advanced semantic deduplication
advanced AI editorial generation
automatic source discovery
multi-platform publishing
multi-page publishing
advanced analytics
machine-learned reputation
AI-assisted response generation
Messenger (messages) webhook handling
conversation thread models
provider-aware natural key for external_interactions
App-level webhook configuration aggregate (webhook_endpoints)
```

The architecture is intentionally prepared for all of these.

---

# 137. Final Technology Baseline

```text
Node.js 22 LTS
TypeScript 7.0
pnpm 12.3
Fastify
PostgreSQL 16
Drizzle ORM 0.45
Redis 7
BullMQ
Zod
Pino
Prometheus
OpenTelemetry-ready
Docker
Docker Compose
Caddy/Nginx
Vitest 5.0
OpenAPI
Git
GitHub Actions
```

**Pinning policy:** `drizzle-orm`, `drizzle-kit`, `typescript`, `postgres`, and `vitest` are **fully pinned** in `package.json` and mirrored in `pnpm-workspace.yaml` `overrides`. `@types/node` uses a caret within the Node 22 major.

---

# 138. Definition of Done

The architecture phase is complete when:

```text
✓ database schema defined (44 tables, DB contract v1.2)
✓ domain interfaces defined
✓ queue contracts defined (20 queues)
✓ source adapter contract defined
✓ publisher adapter defined
✓ interaction adapter defined
✓ webhook ingress contract defined
✓ credential lifecycle defined
✓ transactional outbox defined
✓ content lifecycle defined
✓ story lifecycle defined
✓ publication lifecycle defined
✓ interaction response lifecycle defined
✓ moderation lifecycle defined
✓ failure states defined
✓ reconciliation defined (publication + interaction response)
✓ timezone model defined
✓ security model defined
✓ audit model defined
✓ monitoring defined
✓ backup/recovery defined
✓ CI migration strategy defined
✓ deployment architecture defined
```

At this point the system is sufficiently specified for implementation.

---

# 139. Final Architectural Statement

The Content Automation Platform is not implemented as a monolithic "Facebook bot".

It is a **domain-oriented, event-driven content processing platform** whose publishing destination happens to include Facebook and whose inbound integration happens to include the Meta webhook platform.

Its architecture separates:

```text
OUTBOUND
Discovery
    ↓
Understanding
    ↓
Deduplication
    ↓
Story management
    ↓
Editorial processing
    ↓
Validation
    ↓
Moderation
    ↓
Scheduling
    ↓
Publication
    ↓
Reconciliation
    ↓
Audit

INBOUND
Webhook receipt
    ↓
Verification
    ↓
Persistence + outbox
    ↓
Processing
    ↓
Interaction materialization
    ↓
Policy decision
    ↓
Moderation
    ↓
Response execution
    ↓
Reconciliation
    ↓
Audit
```

The platform is therefore designed to remain operational even when individual sources, AI providers, queues, workers, or external publishing APIs fail.

The authoritative state remains in PostgreSQL, asynchronous execution is handled by Redis/BullMQ through a **transactional outbox** that is the only bridge between the two, all external publication and interaction is isolated behind adapters, uncertain external outcomes are reconciled, and all critical operational decisions remain auditable.

This architecture constitutes the **production-ready implementation baseline for version 0.9.0** and is aligned with the DB v1 logical model and the DB schema contract v1.2. The tactical implementation boundaries defined across v0.8.1 and v0.9.0 are intentionally non-architectural and must be resolved during implementation without changing the established system-of-record, endpoint, outbox, publication, quota, or credential contracts.

---

# 140. Meta Webhook Ingress — new in v0.9.0

The webhook ingress is the **inbound edge** of the platform. It is exposed by `apps/api` and is the only component that speaks the Meta webhook protocol. It does **not** call the Graph API, does **not** dispatch BullMQ jobs directly, and does **not** materialize domain entities. Its sole responsibility is to accept, verify, persist, and enqueue.

## 140.1 Ingress endpoint

```text
POST /api/v1/webhooks/meta
GET  /api/v1/webhooks/meta       (hub.challenge handshake)
```

The POST handler processes inbound events. The GET handler processes the Meta `hub.challenge` verification handshake and is described in §140.6.

## 140.2 Ingress processing order

The POST handler performs **exactly** the following sequence, in order:

```text
1. Read the raw HTTP body (bytes, not parsed JSON).
2. Verify the X-Hub-Signature-256 header against META_APP_SECRET.
   └─ if invalid → HTTP 401, terminate. No persistence.
3. Validate the envelope against the Zod schema.
   └─ if invalid → HTTP 400, terminate. No persistence.
4. BEGIN TRANSACTION
     INSERT INTO webhook_events (...)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id, trace_id
     IF a row was inserted:
       INSERT INTO outbox_jobs (
         queue_name = 'webhook.process',
         job_id     = 'webhook.process:' || event.id,
         payload    = { webhookEventId: event.id },
         trace_id   = event.trace_id
       )
   COMMIT
5. HTTP 200 OK
```

The handler performs **no** Redis call. Redis unavailability cannot block ingress, cannot produce orphaned events, and cannot produce orphaned jobs.

## 140.3 Signature verification

The signature is computed over the **raw HTTP body bytes**, not the parsed JSON. The `X-Hub-Signature-256` header is formatted as `sha256=<hex>`. The handler:

1. Extracts the hex digest from the header.
2. Computes `HMAC-SHA256(META_APP_SECRET, raw_body)`.
3. Compares in constant time.
4. Fails closed on any mismatch, malformed header, or missing header.

A failed verification produces **no** `webhook_events` row. It is logged and counted in `webhook_signature_failed_total`.

## 140.4 Envelope validation

The Zod schema validates the **envelope only**. It does not validate individual `value` shapes, because those are field-specific and version-dependent.

```typescript
const MetaWebhookEnvelopeSchema = z.object({
  object: z.literal('page'),
  entry: z.array(
    z.object({
      id: z.string(),
      time: z.number(),
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.record(z.unknown()),
        }),
      ),
    }),
  ),
});
```

An unknown `field` value is **not** an ingress error. It is handled at processing time (§141.4).

## 140.5 Idempotency

The `webhook_events.idempotency_key` is computed as:

```text
idempotency_key = sha256(provider || raw_body_hash)
```

where `raw_body_hash` is the SHA-256 of the raw HTTP body bytes.

A duplicate POST produces `ON CONFLICT (idempotency_key) DO NOTHING`, which returns zero rows. When zero rows are returned:

- no new `webhook_events` row is inserted;
- no `outbox_jobs` row is inserted;
- the handler still responds with HTTP 200.

This makes the ingress idempotent to Meta's retry behavior.

## 140.6 Handshake

The GET handler processes the Meta `hub.challenge` verification:

```text
GET /api/v1/webhooks/meta
  ?hub.mode=subscribe
  &hub.verify_token=<token>
  &hub.challenge=<challenge>
```

The handler:

1. Loads the `webhook_subscriptions` row matching the endpoint's active provider.
2. Decrypts `verify_token_encrypted` with `WEBHOOK_TOKEN_ENCRYPTION_KEY`.
3. Compares `hub.verify_token` to the decrypted token in constant time.
4. On match:
   - `UPDATE webhook_subscriptions SET last_verified_at = now()`
   - `INSERT INTO audit_logs (action = 'WEBHOOK_SUBSCRIPTION_VERIFIED', ...)`
   - Respond with `hub.challenge` as plain text.
5. On mismatch:
   - Respond with HTTP 403.
   - `INSERT INTO audit_logs (action = 'WEBHOOK_SUBSCRIPTION_VERIFY_FAILED', ...)`.

The handshake does **not** create a `webhook_events` row.

## 140.7 Response codes

| Condition               | HTTP  | Body                            |
| ----------------------- | ----- | ------------------------------- |
| Successful processing   | `200` | `{"status":"ok"}`               |
| Duplicate event         | `200` | `{"status":"ok"}`               |
| Invalid signature       | `401` | `{"error":"invalid_signature"}` |
| Malformed envelope      | `400` | `{"error":"malformed_payload"}` |
| Database error          | `500` | `{"error":"internal"}`          |
| Redis error             | `500` | `{"error":"internal"}`          |
| Own rate limit exceeded | `429` | `{"error":"rate_limited"}`      |

A `500` response causes Meta to retry with exponential backoff. The retry hits the idempotency-key path and produces HTTP 200 without duplicate side effects.

---

# 141. Webhook Processing — new in v0.9.0

The `webhook.process` worker materializes `external_interactions` from a persisted `webhook_events` row.

## 141.1 Worker input

The worker receives only a job identifier:

```json
{ "webhookEventId": "..." }
```

The payload is intentionally small. Full documents are never in queue payloads. The worker loads the `webhook_events` row and reads its `raw_payload`.

## 141.2 Processing order

```text
1. Load webhook_events row by id.
2. Guard status:
   - if PROCESSED → no-op, exit
   - if DEAD_LETTER → no-op, exit
   - otherwise → continue
3. Atomic status transition:
   UPDATE webhook_events
     SET status = 'PROCESSING', updated_at = now()
     WHERE id = :id
       AND status IN ('RECEIVED','FAILED','PROCESSING')
4. Insert webhook_deliveries row (PENDING, attempt_number = N+1)
5. Parse raw_payload into entries × changes
6. Resolve destination (by external_object_id)
7. For each change:
   a. select ChangeExtractor by field
   b. if no extractor → record UNSUPPORTED_FIELD and continue
   c. parse value into a domain interaction draft
   d. upsert external_interactions (idempotent, monotonic occurred_at)
   e. on error → record error, continue
8. Decide final status:
   - all changes succeeded or skipped → PROCESSED
   - retry-eligible failures → FAILED
   - non-retry-eligible failures → DEAD_LETTER
   - mixed → FAILED (partial success; retry is idempotent)
9. Update webhook_events.status, processed_at
10. Update webhook_deliveries.status, finished_at, error_*
```

## 141.3 Transaction boundaries

Each change is materialized in its own transaction. The event-status update is a separate transaction. This ensures:

- a failure in one change does not discard previously successful changes;
- a retry reprocesses only the failed changes (idempotently);
- the `webhook_events` status reflects the aggregate outcome, not the per-change outcome.

## 141.4 Change extraction

Extractors are registered by `field`:

| `field`   | Extractor                | Materializes                   |
| --------- | ------------------------ | ------------------------------ |
| `feed`    | `FeedChangeExtractor`    | `COMMENT`, `REACTION`, or skip |
| `mention` | `MentionChangeExtractor` | `MENTION`                      |

Unrecognized `field` values are recorded with `error_category = 'UNSUPPORTED_FIELD'` and treated as **successful skips**, not failures.

## 141.5 Monotonic upsert

`external_interactions` rows are upserted with monotonic ordering on `occurred_at`:

```sql
INSERT INTO external_interactions (...)
VALUES (...)
ON CONFLICT (interaction_type, external_interaction_id)
DO UPDATE SET
  webhook_event_id   = EXCLUDED.webhook_event_id,
  destination_id     = EXCLUDED.destination_id,
  publication_id     = COALESCE(EXCLUDED.publication_id, external_interactions.publication_id),
  parent_external_id = EXCLUDED.parent_external_id,
  actor_external_id  = EXCLUDED.actor_external_id,
  actor_display_name = EXCLUDED.actor_display_name,
  content            = EXCLUDED.content,
  permalink          = EXCLUDED.permalink,
  occurred_at        = EXCLUDED.occurred_at,
  raw_metadata       = EXCLUDED.raw_metadata,
  updated_at         = now()
WHERE external_interactions.occurred_at <= EXCLUDED.occurred_at;
```

A stale event is skipped, preserving the freshest content. Soft deletion (`verb = "remove"`) is recorded in `raw_metadata` and does not delete the row.

## 141.6 Publication resolution

The worker resolves `publications.id` from `value.post_id`:

```sql
SELECT id FROM publications WHERE external_post_id = $1;
```

If a match exists, `external_interactions.publication_id` is populated. If no match exists, the interaction is still materialized with `publication_id = NULL`. A comment on a post the platform did not publish is not an error.

## 141.7 Error taxonomy

`webhook_deliveries.error_category` uses the canonical taxonomy:

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

`SIGNATURE_INVALID` is not a valid value here because it is rejected at the ingress boundary.

---

# 142. Interaction Response Lifecycle — new in v0.9.0

Interaction responses are the platform's **outbound** reaction to inbound interactions. They are governed by a deterministic policy engine, routed through moderation when required, executed through a dedicated interaction adapter, and reconciled when the outcome is uncertain.

## 142.1 Policy engine

The policy engine decides whether an inbound interaction generates an outbound response, and under which governance:

```typescript
interface InteractionResponsePolicyEngine {
  decide(interaction: ExternalInteraction, context: PolicyContext): Promise<ResponseDecision>;
}

type ResponseDecision =
  | { action: 'IGNORE'; reason: string }
  | { action: 'AUTO_RESPOND'; templateId: string }
  | { action: 'MODERATION_REQUIRED'; reason: string }
  | { action: 'NOTIFICATION_ONLY'; reason: string };
```

The policy engine is **deterministic** and **rule-based**. AI is not used to make the decision in DB v1.

## 142.2 Decision tree

```text
1. interaction_type = REACTION → IGNORE
2. interaction_type = MENTION  → NOTIFICATION_ONLY (v0.9.0 default)
3. interaction_type = COMMENT:
   a. destination.trust_level = LOW → MODERATION_REQUIRED
   b. no matching rules           → MODERATION_REQUIRED
   c. matched rule = auto_respond → AUTO_RESPOND
   d. matched rule = deferred     → MODERATION_REQUIRED
   e. rate_limit_exceeded         → MODERATION_REQUIRED
```

Rules are stored in `system_config` under `interaction_response_rules`. Rule matching is keyword-, regex-, and actor-based.

## 142.3 Template rendering

Response text is produced from templates stored in `system_config` under `interaction_response_templates`. Templates support placeholders:

```text
{{actor_display_name}}
{{content_snippet}}
{{publication_title}}
{{destination_name}}
```

Missing placeholders are **fail-closed**: the render step fails, and the response returns to `MODERATION_REQUIRED`. No AI paraphrasing is applied.

## 142.4 State machine

```text
DRAFT ──► AUTO_RESPOND ─────────────────────────────────► RESPONDED
  │
  └──► MODERATION_REQUIRED ──┬──► APPROVED ──► SCHEDULED ──► QUEUED
                             │                 │              │
                             │                 │              ▼
                             │                 │        IN_PROGRESS ──┬──► RESPONDED
                             │                 │                      ├──► RETRY
                             │                 │                      ├──► FAILED
                             │                 │                      └──► UNKNOWN
                             │                 │                              │
                             │                 │                              ▼
                             │                 │                      RECONCILIATION
                             │                 │
                             │                 └──► FAILED
                             │
                             ├──► REJECTED
                             │
                             └──► EDITED ──► (revalidate) ──► MODERATION_REQUIRED

CANCELLED (from any non-terminal state, admin-initiated)
```

Terminal statuses: `RESPONDED`, `REJECTED`, `FAILED`, `CANCELLED`.

## 142.5 Execution

The `webhook.respond` worker executes an approved response:

```text
1. Load interaction_responses by id.
2. Guard: status ∈ { AUTO_APPROVED, APPROVED, SCHEDULED }
3. Atomic transition:
   UPDATE interaction_responses
     SET status = 'IN_PROGRESS', updated_at = now()
     WHERE id = :id
       AND status IN ('AUTO_APPROVED','APPROVED','SCHEDULED')
4. Insert interaction_response_attempts (PENDING, attempt_number = N+1)
5. Rate limit check via MetaInteractionRateLimiter
6. Decrypt Page Access Token via MetaCredentialService
7. Call Graph API via MetaInteractionAdapter
8. On success → status = RESPONDED, external_response_id set
9. On transient error → status = RETRY
10. On permanent error → status = FAILED
11. On unknown outcome → status = UNKNOWN
```

The rate limiter is checked at three points (§74).

## 142.6 Moderation

Moderation decisions are recorded in `interaction_moderation_actions`:

```text
APPROVE
REJECT
EDIT
ESCALATE
```

`EDIT` requires `previous_body` and returns the response to `MODERATION_REQUIRED` for revalidation.

## 142.7 Reconciliation

Two paths:

**Push reconciliation** — the platform's own outbound response reappears as a `feed` webhook event. `webhook.process` matches it to an `interaction_responses` row by `(destination_id, external_response_id)` and updates the status to `RESPONDED`. This is the preferred path.

**Pull reconciliation** — a scheduled worker queries the Graph API for the response state. Bounded, fallback-only.

Reconciliations are recorded in `interaction_response_reconciliations`.

---

# 143. Credential Lifecycle — new in v0.9.0

The credential lifecycle manages encryption, storage, rotation, health, and cache invalidation for Meta credentials. The implementation lives in `packages/authentication/`.

## 143.1 Encryption provider

```typescript
interface CredentialEncryptionProvider {
  encrypt(plaintext: string, context: EncryptionContext): Promise<EncryptedValue>;
  decrypt(encrypted: EncryptedValue, context: EncryptionContext): Promise<string>;
  activeKeyVersion(): number;
}
```

Algorithm: **AES-256-GCM**.

- Key: 32 bytes, base64-encoded in environment variables.
- IV: 12 random bytes per encryption.
- Auth tag: 16 bytes.
- Additional authenticated data (AAD): `provider || ':' || credential_type || ':' || (destination_id ?? 'app')`.

The AAD binds the ciphertext to its context, preventing ciphertext substitution across destinations or credential types.

Encrypted values are stored as:

```text
v1:base64(iv || ciphertext || tag)
```

The `v1` prefix is the format version. The key version is stored separately in `provider_credentials.encryption_key_version`.

## 143.2 Key rotation

Multiple key versions coexist:

```bash
META_CREDENTIAL_ENCRYPTION_KEYS='{"1":"base64...","2":"base64..."}'
META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION=2
```

- New writes use the active version.
- Reads use the version stored per row.
- Rotation is progressive: a background job re-encrypts rows with old versions.

## 143.3 Service interface

```typescript
interface MetaCredentialService {
  getCredential(input: GetCredentialInput): Promise<DecryptedCredential | null>;
  storeCredential(input: StoreCredentialInput): Promise<ProviderCredential>;
  rotateCredential(input: RotateCredentialInput): Promise<ProviderCredential>;
  invalidateCredential(input: InvalidateCredentialInput): Promise<void>;
  validateCredential(input: GetCredentialInput): Promise<CredentialValidationResult>;
  healthCheck(destinationId: string): Promise<CredentialHealthReport>;
}
```

## 143.4 Health states

```text
VALID
EXPIRING
INVALID
UNKNOWN
```

Transitions:

| From       | To         | Trigger                              | Who                       |
| ---------- | ---------- | ------------------------------------ | ------------------------- |
| `UNKNOWN`  | `VALID`    | First successful validation          | Admin / service           |
| `VALID`    | `EXPIRING` | `expires_at < now + 7d`              | Scheduler                 |
| `EXPIRING` | `VALID`    | Successful refresh                   | `meta.credential.refresh` |
| `EXPIRING` | `INVALID`  | Refresh failure or Graph API 401/403 | Service / adapter         |
| `VALID`    | `INVALID`  | Graph API 401/403                    | Adapter                   |

`INVALID` is sticky. It is cleared only by a successful `validateCredential` or `rotateCredential` call. The webhook processing pipeline may generate notifications about token invalidation, but it does not modify the credential status.

## 143.5 Credential cache

A short-TTL in-memory cache (default 45 seconds) avoids repeated AES-GCM decryption on the publication and response hot paths.

The cache is invalidated when:

- the credential is rotated;
- the credential is invalidated;
- the credential's `last_rotation_at` changes;
- the cache TTL expires.

The cache is per-process. It does not coordinate across processes. This is acceptable because credential changes are rare and the TTL is short.

## 143.6 Publishing pause

The scheduler consults `credentialService.healthCheck(destinationId)` before enqueuing `content.publish`:

```typescript
const health = await credentialService.healthCheck(destinationId);
if (health.overall === 'INVALID') {
  return { enqueued: false, reason: 'CREDENTIAL_INVALID' };
}
```

The `publications` row remains `SCHEDULED`. No new state value is introduced. When the credential is restored, the scheduler automatically picks up the deferred rows.

The `MetaPublisherAdapter` re-checks the credential immediately before the external call.

## 143.7 Credential events from webhooks

The Meta platform may send `token_invalidated` or `token_expired` webhook fields. The `webhook.process` worker handles these **thinly**:

- records the event in `webhook_events`;
- generates a `credential_invalid` notification;
- generates an `audit_logs` entry;
- does **not** rotate or invalidate the credential.

The `MetaCredentialService` performs rotation in a separate, asynchronous flow.

---

# 144. Transactional Outbox — new in v0.9.0

The outbox is a **platform primitive**. It is the only mechanism by which a durable domain transition produces an asynchronous side effect.

## 144.1 Principle

Every durable domain transition that must produce an asynchronous side effect enqueues through `outbox_jobs` inside the **same PostgreSQL transaction** that commits the domain state.

```text
BEGIN
  <domain state mutation>
  INSERT INTO outbox_jobs (queue_name, job_id, payload, trace_id)
COMMIT
```

A separate in-process component, the `OutboxDispatcher`, reads `PENDING` rows and dispatches them to BullMQ.

## 144.2 Rationale

PostgreSQL and Redis are independent systems. No transactional client spans both. Attempting to enqueue directly inside the PostgreSQL transaction produces an unrecoverable split-brain:

```text
COMMIT succeeds, Redis add fails  → orphaned event in DB, never processed
COMMIT fails, Redis add succeeds  → orphaned job in queue, worker crashes on load
```

The outbox pattern removes this class of failure by making the enqueue intent durable in the same system that owns the domain state. Redis becomes a derived cache, not a coordination point.

## 144.3 Enqueue API

```typescript
await txManager.run(async (tx) => {
  const event = await webhookEventsRepo.insertIdempotent(tx, eventData);
  if (event.inserted) {
    await outboxRepo.enqueue(tx, {
      queueName: 'webhook.process',
      jobId: `webhook.process:${event.event.id}`,
      payload: { webhookEventId: event.event.id },
      traceId: event.event.traceId,
    });
  }
});
```

`enqueue` accepts the transaction object as its first parameter. It must be called **inside** an active transaction.

## 144.4 Dispatcher claim

The dispatcher claims rows in two steps to avoid the raw-SQL-returning-type trap:

```sql
-- Step 1: atomic claim via raw SQL
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
RETURNING id;
```

```typescript
// Step 2: read full rows via Drizzle
const claimed = await this.db.execute(claimSql);
if (claimed.length === 0) return [];
const ids = claimed.map((c) => c.id);
const rows = await this.db
  .select()
  .from(outboxJobs)
  .where(inArray(outboxJobs.id, ids))
  .orderBy(asc(outboxJobs.createdAt));
```

The two-step pattern guarantees that `payload` (JSONB) and the timestamp and UUID columns are correctly typed by Drizzle.

Multiple dispatcher instances may operate concurrently. `SKIP LOCKED` guarantees no collision.

## 144.5 Dispatch and recovery

After claiming, the dispatcher calls BullMQ and then marks the row `DISPATCHED`. If the dispatcher crashes between the BullMQ add and the `DISPATCHED` update, the row remains `DISPATCHING`. Recovery restores it to `PENDING` after `OUTBOX_DISPATCH_STALE_THRESHOLD_SECONDS`.

Recovery is safe because BullMQ's `jobId` option deduplicates the re-enqueue. A recovered row produces the same `job_id` and therefore no duplicate job.

## 144.6 Rebuild integration

`system.rebuild` performs two distinct responsibilities:

1. **Outbox dispatch recovery** — restores stale `DISPATCHING` rows to `PENDING` and triggers a dispatch cycle.
2. **Domain-state rebuild** — derives missing work from durable domain state (e.g. `webhook_events.status = 'RECEIVED'` without a corresponding outbox row after cleanup, `publications.status = 'SCHEDULED'`).

Both responsibilities are idempotent. Running `system.rebuild` twice must not produce duplicate publications, duplicate responses, or duplicate webhook processing.

## 144.7 Cleanup

A dedicated `system.outbox.cleanup` job deletes `DISPATCHED` rows older than `OUTBOX_CLEANUP_RETENTION_DAYS` (default 7 days). Cleanup is independent from `system.rebuild` and runs on its own cron schedule.

`PENDING`, `DISPATCHING`, and `FAILED` rows are never deleted by cleanup. `FAILED` rows require manual resolution or an operator-initiated purge.

## 144.8 No foreign keys

`outbox_jobs` intentionally holds no foreign keys. This is deliberate:

- The outbox is generic and must not be coupled to any domain entity's lifecycle.
- Cascade deletion from a domain table must not silently remove outbox rows.
- Time-based cleanup is the only retention mechanism.

The `job_id` string is the sole correlation mechanism between the outbox and the enqueued work.

## 144.9 Do not bypass the outbox

No direct BullMQ enqueue is permitted on a durable-write hot path. Every durable domain transition that produces an asynchronous side effect must go through `outbox_jobs`. This is a normative architectural invariant (see §23.2 invariant 24 in the database contract v1.2).

---

# 145. Cross-Cutting Invariants (new in v0.9.0)

The following invariants are normative across the platform and complement the invariants stated in §23 of `DATABASE_SCHEMA_CONTRACT.md` v1.2.

1. PostgreSQL is the authoritative durable system of record.
2. Redis/BullMQ is authoritative only for transient execution state and queue mechanics.
3. Every durable domain transition that produces an asynchronous side effect enqueues through `outbox_jobs` inside the same PostgreSQL transaction.
4. No direct BullMQ enqueue is permitted on a durable-write hot path.
5. The Meta webhook ingress performs exactly one database transaction per HTTP request and no Redis call on the hot path.
6. `webhook_events.raw_payload` and `webhook_events.raw_body_hash` are immutable after receipt.
7. `webhook_events.signature_verified` is always `true`; signature verification fails closed at the HTTP boundary.
8. External interactions are materialized as their own domain entity and reference content lifecycle entities only via nullable foreign keys with `ON DELETE SET NULL`.
9. Provider credentials are encrypted at rest with application-managed keys. No plaintext secret is persisted in any ordinary application table, log, audit record, or extended cache.
10. The verify token and the provider credential use **distinct** encryption keys.
11. Interaction responses have their own durable lifecycle, their own moderation history, and their own reconciliation history, separate from publications.
12. The `outbox_jobs` table has no foreign keys.
13. Reconciliation is mandatory for every state machine that has an external side effect.
14. Webhook subscription operational health is persisted separately from webhook subscription configuration.
15. The natural external identity of an `external_interactions` row is expressed as a composite of `interaction_type` and `external_interaction_id` in v1.2. Provider-aware natural key evolution is deferred to v1.3.

---

# 146. Deferred Decisions (v0.9.0)

The following are documented as deferred in `DATABASE_SCHEMA_CONTRACT.md` v1.2 and remain deferred in v0.9.0:

- D-001: Authentication session/token persistence
- D-002: Image status vocabulary
- D-003: Image rights taxonomy
- D-004: Entity taxonomy
- D-005: Category taxonomy
- D-006: AI cost currency/unit
- D-007: Persistent endpoint execution history
- D-008: Interaction threading (`parent_external_id` is present, but the full thread model is deferred)
- D-009: Webhook subscription health — storage resolved in v1.2, use deferred
- D-010: Response template storage (currently in `system_config`)
- D-011: Response rule storage (currently in `system_config`)
- D-012: AI-assisted response generation
- D-013: Multi-provider vs multi-page webhook scope
- D-014: Outbox payload schema versioning
- D-015: Credential rotation history
- D-016: Provider-aware natural key for `external_interactions`

Each decision's full rationale is documented in `DATABASE_SCHEMA_CONTRACT.md` v1.2 §24.

---

# 147. Contract Status

**FINAL — PRODUCTION-READY IMPLEMENTATION BASELINE FOR v0.9.0**

This document is the normative behavioral specification for the Content Automation Platform version 0.9.0. It is aligned with:

- `LOGICAL_MODEL_SPECIFICATION.md` v1.0
- `DATABASE_SCHEMA_CONTRACT.md` v1.2

The v0.9.0 additions extend the platform with:

- the Meta inbound webhook slice;
- the interaction response lifecycle;
- the provider credential lifecycle;
- the unified transactional outbox.

These additions do not alter the system-of-record boundary, the endpoint model, the publication state machine, or the AI quota contract. They extend the platform with a well-isolated inbound event domain and formalize the outbox pattern as a platform primitive.

The architecture remains a **domain-oriented, event-driven content processing platform** whose publishing destination happens to include Facebook and whose inbound integration happens to include the Meta webhook platform.

The authoritative state remains in PostgreSQL, asynchronous execution is handled by Redis/BullMQ through a transactional outbox that is the only bridge between the two, all external publication and interaction is isolated behind adapters, uncertain external outcomes are reconciled, and all critical operational decisions remain auditable.

**Implementation gate:** before changing the platform behavior in a way that affects durable state, external contracts, or cross-domain invariants, update this document and the dependent contract documents first. The source-of-truth hierarchy is:

1. `LOGICAL_MODEL_SPECIFICATION.md`
2. `DATABASE_SCHEMA_CONTRACT.md`
3. this `TECHNICAL_SPECIFICATION.md`
4. Drizzle schema implementation
5. Generated PostgreSQL migrations
