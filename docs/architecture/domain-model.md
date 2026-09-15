# Domain Model

This document describes the domain entities of the Content Platform, the
boundaries between them, and the lifecycle that connects them. It is the
bridge between the abstract principles in
[`system-overview.md`](./system-overview.md) and the concrete persistence
model in [`data-model.md`](./data-model.md).

---

## Domain boundaries

The platform is composed of **six** domains, each with its own identity,
lifecycle, and persistence slice.

```text
┌──────────────────────┐    ┌──────────────────────┐
│   Ingestion          │    │   Content             │
│   ────────────       │    │   ─────────           │
│   Source             │    │   ContentItem         │
│   SourceEndpoint     │    │   ContentVersion      │
│   DiscoveredResource │    │   ContentFingerprint  │
│   DiscoveryObserv.   │    │   ContentEntity       │
│   RawResource        │    │   DuplicateMatch      │
│   SourceItem         │    │   ContentCategory     │
│   ProvenanceEvent    │    │   ContentUrl          │
└──────────┬───────────┘    └──────────┬───────────┘
           │                            │
           │    produces SourceItem     │
           └───────────────┬────────────┘
                           │
                           ▼
┌──────────────────────┐    ┌──────────────────────┐
│   Story              │    │   Editorial           │
│   ─────              │    │   ─────────           │
│   Story              │    │   PublicationCandidate│
│   StoryMember        │    │   ModerationAction    │
└──────────┬───────────┘    │   ContentValidation   │
           │                └──────────┬───────────┘
           │                           │
           └────────────┬──────────────┘
                        │
                        ▼
┌──────────────────────┐    ┌──────────────────────┐
│   Publication        │    │   Inbound             │
│   ────────────       │    │   ───────             │
│   Destination        │    │   WebhookSubscription │
│   Publication        │    │   WebhookEvent        │
│   PublicationAttempt │    │   WebhookDelivery     │
│   PublicationRecon.  │    │   ExternalInteraction │
│                      │    │   InteractionResponse │
│                      │    │   InteractionAttempt  │
└──────────────────────┘    └──────────────────────┘

                    Cross-cutting
                    ─────────────
                    OutboxJob
                    AuditLog
                    SystemConfig
                    ProviderCredential
```

The domains are **coupled through explicit identity references**, not
through shared mutable state. A `Publication` references a
`PublicationCandidate` by ID. An `ExternalInteraction` references a
`Publication` by ID **or** leaves the reference `NULL`. No domain reaches
into another domain's internals.

---

## Domain: Ingestion

**Purpose.** Discover content from configured sources and produce
structured `SourceItem` records.

**Entities.**

| Entity                 | Role                                                             |
| ---------------------- | ---------------------------------------------------------------- |
| `Source`               | Logical publisher, brand, or content origin. No `type` or `url`. |
| `SourceEndpoint`       | Concrete technical access point. Owns endpoint-specific state.   |
| `SourceEndpointHealth` | Operational health of an endpoint. 1:1 with the endpoint.        |
| `DiscoveredResource`   | Canonical candidate identity (unique `canonical_url`).           |
| `DiscoveryObservation` | Immutable detection event (multi-path discovery).                |
| `RawResource`          | Raw acquisition snapshot. One resource → many snapshots.         |
| `SourceItem`           | Structured extraction result before normalization.               |
| `ProvenanceEvent`      | Immutable cross-cutting lineage record.                          |

**Key relationships.**

```text
Source 1:N SourceEndpoint
SourceEndpoint 1:1 SourceEndpointHealth
SourceEndpoint 1:N DiscoveryObservation
DiscoveredResource 1:N DiscoveryObservation
DiscoveredResource 1:N RawResource
RawResource 0:1 SourceItem
SourceItem 0:1 ContentItem  (after normalization)
ProvenanceEvent N:1 SourceEndpoint  (nullable, ON DELETE SET NULL)
```

**Lifecycle.**

```text
Source:   ACTIVE | PAUSED | DISABLED
Reputation (independent):
          VERIFIED | NEUTRAL | FLAGGED
Endpoint: ACTIVE | PAUSED | DISABLED
```

---

## Domain: Content

**Purpose.** The platform's canonical content identity and the
intelligence artifacts derived from it.

**Entities.**

| Entity               | Role                                                          |
| -------------------- | ------------------------------------------------------------- |
| `ContentItem`        | Canonical content identity (unique `canonical_url`).          |
| `ContentVersion`     | Immutable normalized representation at a revision.            |
| `ContentUrl`         | Alternate URL (ALIAS / AMP / TRACKING_VARIANT).               |
| `ContentEntity`      | Extracted named or typed entity.                              |
| `ContentCategory`    | Category assignment.                                          |
| `ContentFingerprint` | Structural fingerprint (SHA256, SIMHASH, MINHASH, EMBEDDING). |
| `DuplicateMatch`     | Evidence that two items are duplicates.                       |

**Key relationships.**

```text
ContentItem 1:N ContentVersion
ContentItem 1:N ContentUrl
ContentItem 1:N ContentEntity
ContentItem 1:N ContentCategory
ContentItem 1:N ContentFingerprint
ContentItem N:M ContentItem  (via DuplicateMatch)
ContentItem 0:1 ContentVersion  (as current_version_id)
```

**The mutual FK.** `ContentItem.current_version_id` points to
`ContentVersion.id`, and `ContentVersion.content_item_id` points to
`ContentItem.id`. This mutual dependency is resolved at migration time
by creating both tables first and adding the
`content_items.current_version_id` foreign key after
`content_versions` exists.

**Lifecycle.**

```text
ContentItem: DRAFT | PUBLISHED | ARCHIVED | TRASHED
```

---

## Domain: Story

**Purpose.** Group content items that describe the same underlying
real-world event, independently of source identity.

**Entities.**

| Entity        | Role                                                |
| ------------- | --------------------------------------------------- |
| `Story`       | Thematic grouping of related content items.         |
| `StoryMember` | Explicit N:M relationship with membership metadata. |

**Key relationships.**

```text
Story N:M ContentItem  (via StoryMember)
```

**Lifecycle.**

```text
Story: FORMING | ACTIVE | ARCHIVED | LOCKED
StoryMember.membership_type: PRIMARY | MENTIONED
StoryMember.assignment_method: AUTOMATIC | MANUAL
```

---

## Domain: Editorial

**Purpose.** Produce a validated, versioned publication candidate and
route it through moderation.

**Entities.**

| Entity                 | Role                                                            |
| ---------------------- | --------------------------------------------------------------- |
| `PublicationCandidate` | Versioned content representation intended for publication.      |
| `ModerationAction`     | Immutable moderation decision (APPROVE, REJECT, EDIT, ARCHIVE). |

**Key relationships.**

```text
PublicationCandidate N:1 ContentItem
PublicationCandidate N:1 Story
PublicationCandidate 0:1 Image
ModerationAction N:1 ContentItem
ModerationAction N:1 PublicationCandidate  (nullable)
ModerationAction N:1 User
```

---

## Domain: Publication

**Purpose.** Publish approved content to external destinations and
reconcile uncertain outcomes.

**Entities.**

| Entity                      | Role                                            |
| --------------------------- | ----------------------------------------------- |
| `Destination`               | Persisted publication target (Meta Page, etc.). |
| `Publication`               | Durable intent and external state.              |
| `PublicationAttempt`        | Durable execution attempt history.              |
| `PublicationReconciliation` | Investigation of uncertain outcomes.            |

**Key relationships.**

```text
Publication N:1 PublicationCandidate
Publication N:1 Destination
Publication 1:N PublicationAttempt
Publication 1:N PublicationReconciliation
PublicationAttempt 0:1 PublicationReconciliation
```

**Lifecycle.**

```text
Publication:
  SCHEDULED → RESERVED → IN_PROGRESS → PUBLISHED
                                      ├→ RETRY
                                      ├→ FAILED
                                      └→ RECONCILIATION
```

**Idempotency.** The application-level lock key is
`publication:{contentId}:{destinationId}`. A partial index on
`publications.external_post_id` serves the hot-path lookup performed by
the webhook processing pipeline.

---

## Domain: Inbound

**Purpose.** Receive webhooks from external providers, materialize
inbound interactions, and produce outbound responses.

**Entities.**

| Entity                              | Role                                                           |
| ----------------------------------- | -------------------------------------------------------------- |
| `WebhookSubscription`               | Technical subscription configuration. 1:1 health companion.    |
| `WebhookSubscriptionHealth`         | Operational health of a subscription.                          |
| `WebhookEvent`                      | Immutable receipt of an HTTP POST.                             |
| `WebhookDelivery`                   | Durable history of processing attempts.                        |
| `ExternalInteraction`               | Materialized inbound interaction (COMMENT, REACTION, MENTION). |
| `InteractionResponse`               | Durable intent to publish an outbound response.                |
| `InteractionResponseAttempt`        | Durable execution attempt history.                             |
| `InteractionModerationAction`       | Durable moderation decision.                                   |
| `InteractionResponseReconciliation` | Investigation of uncertain outcomes.                           |

**Key relationships.**

```text
WebhookSubscription 1:1 WebhookSubscriptionHealth
WebhookSubscription N:1 Destination
WebhookEvent N:1 Destination  (nullable, ON DELETE SET NULL)
WebhookEvent 1:N WebhookDelivery
WebhookEvent 1:N ExternalInteraction  (nullable, ON DELETE SET NULL)
ExternalInteraction N:1 Publication  (nullable, ON DELETE SET NULL)
ExternalInteraction 1:1 InteractionResponse
InteractionResponse 1:N InteractionResponseAttempt
InteractionResponse 1:N InteractionModerationAction
InteractionResponse 1:N InteractionResponseReconciliation
```

**Lifecycle.**

```text
WebhookEvent: RECEIVED → PROCESSING → PROCESSED | FAILED | DEAD_LETTER

ExternalInteraction:  soft-deleted only (raw_metadata.deleted = true)

InteractionResponse:
  DRAFT ─┬─> AUTO_RESPOND ──────────────────────> RESPONDED
         └─> MODERATION_REQUIRED ─┬─> APPROVED ──> SCHEDULED ──> RESPONDED
                                  └─> REJECTED
```

**Idempotency.** Three layers:

1. **HTTP receipt** — `webhook_events.idempotency_key` (SHA-256 of the
   body hash).
2. **Job** — `webhook.process:{webhookEventId}` (BullMQ deduplication).
3. **Domain** — `(interaction_type, external_interaction_id)` unique
   constraint and monotonic `occurred_at`.

---

## Cross-cutting domains

### Platform patterns

| Entity      | Role                                           |
| ----------- | ---------------------------------------------- |
| `OutboxJob` | Unified transactional outbox. No foreign keys. |

### Configuration

| Entity           | Role                                   |
| ---------------- | -------------------------------------- |
| `SystemConfig`   | Database-backed runtime configuration. |
| `ConfigAuditLog` | Append-only config change history.     |

### Credentials

| Entity               | Role                                        |
| -------------------- | ------------------------------------------- |
| `ProviderCredential` | Encrypted provider authentication material. |

### Observability

| Entity         | Role                                  |
| -------------- | ------------------------------------- |
| `AiUsage`      | Durable AI usage accounting.          |
| `SystemLog`    | Selected structured operational logs. |
| `Notification` | Durable operational notifications.    |
| `AuditLog`     | Central cross-domain audit trail.     |

---

## The canonical lifecycle

```text
SOURCE ITEM
    ↓  (normalization)
CONTENT ITEM
    ↓  (clustering)
STORY
    ↓  (conflict resolution + editorial processing)
PUBLICATION CANDIDATE
    ↓  (validation + moderation + scheduling)
PUBLICATION
    ↓  (external API)
EXTERNAL POST
    ↓  (webhook)
EXTERNAL INTERACTION
    ↓  (policy + moderation)
INTERACTION RESPONSE
    ↓  (external API)
EXTERNAL RESPONSE
    ↓  (push reconciliation via webhook)
RESPONDED
```

Every major transition is auditable.

---

## Related documents

- [`system-overview.md`](./system-overview.md) — the pipeline and principles
- [`data-model.md`](./data-model.md) — the persistence model
- [`../../LOGICAL_MODEL_SPECIFICATION.md`](../../LOGICAL_MODEL_SPECIFICATION.md) — DB v1 logical model
- [`../../DATABASE_SCHEMA_CONTRACT.md`](../../DATABASE_SCHEMA_CONTRACT.md) — physical persistence contract
