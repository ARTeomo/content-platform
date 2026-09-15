# Data Model at a Glance

This document summarizes the 44 persistence tables of DB v1.2 by
category. It is a **map**, not a specification. The authoritative
sources are:

- [`../../LOGICAL_MODEL_SPECIFICATION.md`](../../LOGICAL_MODEL_SPECIFICATION.md) — logical model
- [`../../DATABASE_SCHEMA_CONTRACT.md`](../../DATABASE_SCHEMA_CONTRACT.md) — physical schema

---

## Table categories

| Category                        | Tables | Purpose                                                              |
| ------------------------------- | -----: | -------------------------------------------------------------------- |
| Core logical model              |     15 | Ingestion, content, deduplication, clustering                        |
| Supporting platform persistence |     18 | Authentication, editorial, media, publication, config, observability |
| Inbound event persistence       |      4 | Meta webhook receipts, deliveries, interactions                      |
| Provider credentials + response |      5 | Encrypted credentials and outbound responses                         |
| Platform patterns               |      1 | Transactional outbox                                                 |
| Inbound health companion        |      1 | Webhook subscription health                                          |
| **Total**                       | **44** |                                                                      |

---

## Core logical model (15 tables)

Defined by the DB v1 Logical Model Specification. See
[`../../LOGICAL_MODEL_SPECIFICATION.md`](../../LOGICAL_MODEL_SPECIFICATION.md).

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

**Ingestion identity chain.**

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

**Content intelligence.**

```text
ContentItem
  ├── ContentUrl (ALIAS, AMP, TRACKING_VARIANT)
  ├── ContentVersion (immutable revisions)
  ├── ContentFingerprint (SHA256, SIMHASH, MINHASH, EMBEDDING)
  ├── DuplicateMatch (evidence, separate from identity)
  └── StoryMember (N:M to Story)
```

---

## Supporting platform persistence (18 tables)

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

### Authentication

```text
roles 1:N users
```

### Publication

```text
PublicationCandidate N:1 ContentItem
PublicationCandidate N:1 Story
PublicationCandidate 0:1 Image
Publication N:1 PublicationCandidate
Publication N:1 Destination
Publication 1:N PublicationAttempt
Publication 1:N PublicationReconciliation
PublicationAttempt 0:1 PublicationReconciliation
```

---

## Inbound event persistence (4 tables)

```text
webhook_subscriptions
webhook_events
webhook_deliveries
external_interactions
```

```text
WebhookSubscription N:1 Destination
WebhookEvent N:1 Destination  (ON DELETE SET NULL)
WebhookEvent 1:N WebhookDelivery
WebhookEvent 1:N ExternalInteraction  (ON DELETE SET NULL)
ExternalInteraction N:1 Publication  (ON DELETE SET NULL)
```

**Key uniqueness constraints.**

```text
webhook_events.idempotency_key
(webhook_event_id, attempt_number)
(interaction_type, external_interaction_id)
```

**Monotonic guarantee.** `external_interactions.occurred_at` advances
monotonically per interaction. A stale event does not overwrite a
fresher one.

---

## Provider credentials + response (5 tables)

```text
provider_credentials
interaction_responses
interaction_response_attempts
interaction_moderation_actions
interaction_response_reconciliations
```

**Credential encryption.**

- AES-256-GCM
- Additional authenticated data binds the ciphertext to
  `(provider, credential_type, destination_id)`.
- Key version stored per row; rotation does not require a full-table
  rewrite in a single transaction.
- A partial unique index using `COALESCE` deduplicates `APP`-scope rows
  where `destination_id IS NULL`.

**Interaction response lifecycle.**

```text
InteractionResponse N:1 ExternalInteraction
InteractionResponse N:1 Destination
InteractionResponse 1:N InteractionResponseAttempt
InteractionResponse 1:N InteractionModerationAction
InteractionResponse 1:N InteractionResponseReconciliation
```

---

## Platform patterns (1 table)

```text
outbox_jobs
```

- **No foreign keys.** Deliberate.
- **`job_id` unique.** Deterministic, idempotent, BullMQ-compatible.
- **`payload` identifiers only.** Never a full document.
- **Time-based cleanup.** `PENDING`, `DISPATCHING`, and `FAILED` rows
  are never deleted by cleanup.
- **Partial index on `(status, created_at)` where status is `PENDING`
  or `DISPATCHING`.**

---

## Inbound health companion (1 table)

```text
webhook_subscription_health
```

1:1 with `webhook_subscriptions`. Mirrors the `source_endpoint_health`
pattern from DB v1 core. Storage now, use later — health metrics
consumption is deferred (D-009).

---

## Migration order

The baseline migration creates objects in dependency order. The 14
migrations in `packages/database/migrations/` implement this sequence:

```text
0000 — foundation:   pgcrypto, roles, users, destinations
0001 — outbox:       outbox_jobs
0002 — webhook:      webhook_subscriptions, webhook_subscription_health,
                     webhook_events, webhook_deliveries,
                     external_interactions
0003 — ingestion A:  sources, source_endpoints, source_endpoint_health
0004 — ingestion B:  discovered_resources, discovery_observations,
                     provenance_events, raw_resources
0005 — content A:    stories, content_items, content_versions, source_items
0006 — content B:    content_entities, content_categories,
                     content_fingerprints, duplicate_matches,
                     content_urls, story_members
0007 — media:        images, image_rights
0008 — publication:  publication_candidates, moderation_actions,
                     publications, publication_attempts,
                     publication_reconciliations
0009 — deferred FK:  external_interactions.publication_id → publications.id
0010 — credential:   provider_credentials
0011 — interaction:  interaction_responses, interaction_response_attempts,
                     interaction_moderation_actions,
                     interaction_response_reconciliations
0012 — config:       system_config, config_audit_log
0013 — observability: ai_usage, system_logs, notifications, audit_logs
```

The `pgcrypto` extension is created in `0000` and is never re-declared.

---

## Query patterns supported by design

### Endpoint scheduling

```sql
SELECT * FROM source_endpoints
WHERE status = 'ACTIVE' AND next_poll_at <= now()
ORDER BY next_poll_at;
```

### Canonical content lookup

```sql
SELECT * FROM content_items WHERE canonical_url = $1;
```

### Fingerprint lookup

```sql
SELECT * FROM content_fingerprints
WHERE algorithm = $1 AND fingerprint_value = $2;
```

### Story membership

```sql
SELECT * FROM story_members
WHERE story_id = $1
ORDER BY added_at DESC;
```

### Provenance trace

```sql
SELECT * FROM provenance_events
WHERE target_entity_type = $1 AND target_entity_id = $2;
```

### Webhook ingress deduplication

```sql
INSERT INTO webhook_events (idempotency_key, ...)
VALUES (...)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id;
```

### Pending outbox dispatch

```sql
SELECT * FROM outbox_jobs
WHERE status = 'PENDING'
ORDER BY created_at
LIMIT $1
FOR UPDATE SKIP LOCKED;
```

### Publication lookup by external ID

```sql
SELECT id FROM publications WHERE external_post_id = $1;
```

Served by the partial index `publications_external_post_id_idx`.

### Credential expiry scan

```sql
SELECT * FROM provider_credentials
WHERE credential_type = 'PAGE_ACCESS_TOKEN'
  AND expires_at < now() + interval '7 days'
  AND status IN ('VALID', 'EXPIRING');
```

---

## Related documents

- [`domain-model.md`](./domain-model.md) — domain entities and boundaries
- [`../../LOGICAL_MODEL_SPECIFICATION.md`](../../LOGICAL_MODEL_SPECIFICATION.md) — logical model
- [`../../DATABASE_SCHEMA_CONTRACT.md`](../../DATABASE_SCHEMA_CONTRACT.md) — physical contract
- [`../conventions/database-schema.md`](../conventions/database-schema.md) — Drizzle conventions
