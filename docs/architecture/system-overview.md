# System Overview

This document describes what the Content Platform does, the shape of its
processing pipeline, and the boundaries between its subsystems. It is the
shortest document that gives a complete architectural picture.

---

## What the system does

The Content Platform is a **domain-oriented, event-driven content
processing platform**. It continuously:

1. **Discovers** content from configured sources.
2. **Normalizes** heterogeneous source formats into a canonical form.
3. **Classifies** content using deterministic and optional AI-assisted
   methods.
4. **Extracts** domain entities.
5. **Detects** exact and near duplicates.
6. **Groups** related content into story clusters.
7. **Selects** the preferred representation of each story.
8. **Processes** content through optional summarization and translation.
9. **Validates** the publication package before it moves forward.
10. **Routes** content through configurable human moderation.
11. **Schedules** approved material.
12. **Publishes** it through authorized external APIs.
13. **Reconciles** uncertain external outcomes.
14. **Audits** every important state transition.

The system is **not** a monolithic "Facebook bot". It is a general-purpose
content processing platform whose publishing destinations **happen to**
include Facebook.

---

## The pipeline

```text
                       EXTERNAL SOURCES
                             │
                             ▼
                      ┌──────────────┐
                      │ Source Poller│
                      └──────┬───────┘
                             │  source.poll
                             ▼
                      ┌──────────────┐
                      │ Normalization│
                      └──────┬───────┘
                             │  content.normalize
                             ▼
                      ┌──────────────┐
                      │ Relevance    │
                      │ + Entities   │
                      └──────┬───────┘
                             │  content.classify
                             │  content.entity_extract
                             ▼
                      ┌──────────────┐
                      │ Deduplication│
                      └──────┬───────┘
                             │  content.duplicate_check
                             ▼
                      ┌──────────────┐
                      │ Story        │
                      │ Clustering   │
                      └──────┬───────┘
                             │  content.cluster
                             │  content.resolve_conflict
                             ▼
                      ┌──────────────┐
                      │ Processing   │
                      │ (summary,    │
                      │  translation)│
                      └──────┬───────┘
                             │  content.process
                             ▼
                      ┌──────────────┐
                      │ Validation   │
                      └──────┬───────┘
                             │  content.validate
                             ▼
                      ┌──────────────┐
                      │ Image Policy │
                      │ + Resolver   │
                      └──────┬───────┘
                             │  content.image_resolve
                             ▼
                      ┌──────────────┐
                      │ Moderation   │
                      └──────┬───────┘
                             │  content.moderate
                             ▼
                      ┌──────────────┐
                      │ Scheduling   │
                      └──────┬───────┘
                             │  content.publish
                             ▼
                      ┌──────────────┐
                      │ Publisher    │
                      │ Adapter      │
                      └──────┬───────┘
                             │
                             ▼
                      EXTERNAL POST

                      ┌──────────────┐
                      │ Reconciliation│ ◄── (unknown outcomes)
                      └──────────────┘
```

Each pipeline stage is a BullMQ queue. The pipeline is **reconstructible**
from PostgreSQL state: if Redis is lost, `system.rebuild` repopulates the
queues from durable records.

---

## The two-way Meta integration

The Meta platform participates in the system in **two directions**.

```text
                    ┌─────────────────────────┐
                    │      Meta Platform      │
                    └──┬────────────────────┬─┘
                       │                    │
              OUTBOUND │                    │  INBOUND
           (publish)   │                    │  (webhook)
                       ▼                    ▼
              ┌──────────────────┐  ┌──────────────────┐
              │ MetaPublisher    │  │ Webhook Ingress  │
              │ Adapter          │  │ (apps/api)       │
              └────────┬─────────┘  └────────┬─────────┘
                       │                     │
                       ▼                     ▼
              ┌──────────────────┐  ┌──────────────────┐
              │ publications     │  │ webhook_events   │
              │ publication_     │  │ webhook_         │
              │ attempts         │  │ deliveries       │
              │ reconciliations  │  └────────┬─────────┘
              └────────┬─────────┘           │
                       │                     ▼
                       │           ┌──────────────────┐
                       │           │ webhook.process  │
                       │           └────────┬─────────┘
                       │                    │
                       │                    ▼
                       │           ┌──────────────────┐
                       │           │ external_        │
                       │           │ interactions     │
                       │           └────────┬─────────┘
                       │                    │
                       │                    ▼
                       │           ┌──────────────────┐
                       │           │ Policy Engine    │
                       │           └────────┬─────────┘
                       │                    │
                       │           ┌────────┴────────┐
                       │           ▼                 ▼
                       │       AUTO_RESPOND    MODERATION
                       │           │                 │
                       │           └────────┬────────┘
                       │                    ▼
                       │           ┌──────────────────┐
                       │           │ webhook.respond  │
                       │           └────────┬─────────┘
                       │                    │
                       └────────────────────┘
                          (push reconciliation:
                           own response → feed webhook)
```

The two directions **meet** at the push-reconciliation step: when the
platform's own outbound response appears on the Page feed, Meta sends a
`feed` webhook event about it, `webhook.process` materializes the
interaction, and the corresponding `interaction_responses` row is
updated to `RESPONDED`. This is a natural consequence of the two-way
integration, not a special case.

---

## The system-of-record boundary

```text
                      PostgreSQL
        ┌────────────────────────────────────────┐
        │  durable domain state                  │
        │  canonical artifacts                   │
        │  provenance                            │
        │  endpoint health                       │
        │  webhook subscription health           │
        │  business history                      │
        │  audit history                         │
        │  outbox intent                         │
        └────────────────────────────────────────┘

                      Redis / BullMQ
        ┌────────────────────────────────────────┐
        │  transient execution state             │
        │  queue scheduling                      │
        │  retries                               │
        │  worker diagnostics                    │
        └────────────────────────────────────────┘

                      OutboxDispatcher
        ┌────────────────────────────────────────┐
        │  bridges PostgreSQL intent to Redis    │
        │  never authoritative for domain state  │
        │  recoverable at every stage            │
        └────────────────────────────────────────┘
```

The rule is simple:

- **PostgreSQL answers "what should happen?"**
- **Redis/BullMQ answers "what should execute now?"**
- **The outbox is the only bridge between them.**

No business state is ever reconstructed from Redis.

---

## The five principles, restated with consequences

### 1. PostgreSQL is the authoritative system of record

**Consequence.** Every durable write is committed to PostgreSQL. The
`outbox_jobs` table records the intent to enqueue asynchronous work in
the same transaction. If Redis is lost, no business state is lost.

### 2. Redis/BullMQ is the asynchronous execution layer

**Consequence.** Redis may be drained, flushed, or restarted at any
time. `system.rebuild` reconstructs pending work from PostgreSQL. Redis
is a cache, not a database.

### 3. Every important state transition is explicit and auditable

**Consequence.** Every mutable table has a `status` column with a
`CHECK` constraint that enumerates the legal values. Every transition
is either auditable through an existing table or produces an entry in
`audit_logs`. Hidden state is a defect.

### 4. Uncertain external outcomes are reconciled, not blindly retried

**Consequence.** An `UNKNOWN` external outcome is a distinct state
(`publications.status = 'RECONCILIATION'`,
`interaction_responses.status = 'UNKNOWN'`). Reconciliation may proceed
by push (the platform's own response reappearing as an inbound webhook)
or by pull (a bounded scheduled query). Blind retry is forbidden.

### 5. The system fails closed when mandatory validation cannot be completed

**Consequence.** A webhook with an invalid signature is rejected at the
HTTP boundary. A publication package that fails mandatory validation is
`REVIEW`, not `PUBLISH`. An unsupported endpoint capability is a hard
error, not a silent fallback.

---

## What is _not_ in the system

The following are deliberate non-goals of the platform:

- Generating artificial engagement
- Mass-liking or mass-commenting third-party content
- Creating fake accounts
- Circumventing platform restrictions or rate limits
- Scraping protected or authenticated content without authorization
- Reproducing complete copyrighted articles
- Republishing images without appropriate permission
- Impersonating source publishers

These are enforced as invariants at the architectural level, not as
optional configuration.

---

## Related documents

- [`domain-model.md`](./domain-model.md) — domain entities and lifecycle
- [`data-model.md`](./data-model.md) — the persistence model
- [`module-map.md`](./module-map.md) — package layout and dependency rules
- [`../adr/`](../adr/) — architecture decision records
- [`../../TECHNICAL_SPECIFICATION.md`](../../TECHNICAL_SPECIFICATION.md) — full behavioral specification
