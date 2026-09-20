# META_INTEGRATION_SPECIFICATION.md

**Document:** `META_INTEGRATION_SPECIFICATION.md`
**Version:** 1.4
**Status:** Current Technical Specification / System Behavior Contract
**Normative status:** This document is a system contract, not an audit, implementation status report, or remediation plan.
**Project:** Content Platform
**Repository:** `https://github.com/ARTeomo/content-platform`
**Baseline:** Current Meta architecture and DB v1.2 persistence model
**Supersedes:** `META_INTEGRATION_SPECIFICATION.md` v1.0 historical baseline
**Historical predecessor:** `META_INTEGRATION_SPECIFICATION_v1.0.md` — Phase 18a baseline

---

## 1. Document Purpose

This document is the current technical specification for the Meta integration boundary of the Content Platform.

It consolidates the Meta integration requirements that were established across the project baseline and defines the required behavior of the established Meta architecture, incorporating the architectural decisions established through Phase 19.

The document is a **normative technical contract** for the Meta boundary. It defines the architecture and the behavior that the Meta integration must provide. Implementation status, remediation sequencing and development work orders are outside the purpose of this document.

The governing hierarchy remains:

```text
PROJECT / DOMAIN ARCHITECTURE
        |
        v
TECHNICAL_SPECIFICATION.md v0.9.0
        |
        +----------------------+
        |                      |
        v                      v
LOGICAL_MODEL_SPECIFICATION   META_INTEGRATION_SPECIFICATION
v1.0                          v1.4
        |                      |
        v                      |
DATABASE_SCHEMA_CONTRACT       |
v1.2                           |
        |                      |
        +----------+-----------+
                   v
          Drizzle schema
                   |
                   v
              migrations
                   |
                   v
          repositories/services
                   |
                   v
               workers
                   |
                   v
             Meta adapters
                   |
                   v
                 E2E
```

For all Meta-specific behavioral requirements, this specification supersedes the Meta-specific portions of `TECHNICAL_SPECIFICATION.md` v0.9.0 (§69–79 and §140–145). The platform-wide technical specification remains authoritative for cross-domain requirements and platform-wide invariants, and it refers to this document for Meta-specific detail.

The Meta specification must not independently redefine logical or physical persistence structures.

---

# 2. Version History and Baseline Position

## 2.1 Historical Meta specification v1.0

The historical Meta integration specification was explicitly marked:

```text
Version: 1.0

Status: Architecture / Implementation Contract
Baseline: Phase 18a complete
```

Its phase model was:

```text
Phase 18a  COMPLETE
Phase 18b  NEXT
Phase 19   AFTER 18b
```

That document is retained as a historical baseline because it records the architecture at the Phase 18a boundary.

It is not the current implementation status.

## 2.2 Current Meta specification v1.4

This document retains the architectural decisions of Meta specification v1.0 and defines the current Meta architecture, persistence boundary, runtime behavior, failure handling, reconciliation model, security requirements and operational behavior.

The specification incorporates the architecture established through Phase 18a, Phase 18b and Phase 19. Phase history is retained as provenance; it is not a separate implementation-status contract.

---

# 3. Source-of-Truth References

This specification is aligned with the following project contracts:

| Document                                 | Version | Role                                                |
| ---------------------------------------- | ------: | --------------------------------------------------- |
| `TECHNICAL_SPECIFICATION.md`             |   0.9.0 | Platform-wide behavioral and architectural contract |
| `LOGICAL_MODEL_SPECIFICATION.md`         |     1.0 | Logical domain model                                |
| `DATABASE_SCHEMA_CONTRACT.md`            |     1.2 | Physical persistence contract                       |
| `META_INTEGRATION_SPECIFICATION_v1.0.md` |     1.0 | Historical Phase 18a Meta architecture              |

The current Meta specification is subordinate to the platform-wide architectural, logical-model and database contracts except where it explicitly specializes Meta-specific behavior. It does not redefine the logical domain model or physical database schema. For Meta-specific behavior, this document is the current detailed behavioral authority.

---

# 4. Scope

The Meta boundary covers:

- Meta Page `feed` webhook events;
- Page `mention` webhook events;
- webhook verification handshake;
- `X-Hub-Signature-256` verification;
- envelope validation;
- destination resolution;
- idempotent webhook persistence;
- transactional outbox integration;
- asynchronous webhook processing;
- external interaction materialization;
- interaction-response policy;
- response templates;
- moderation gating;
- interaction-response execution;
- interaction-response attempt history;
- interaction-response reconciliation;
- outbound content publication;
- publication attempt history;
- publication reconciliation;
- external post identity;
- provider credential lifecycle;
- Meta error normalization;
- Meta-specific rate limiting;
- Meta integration health and operational observability.

The integration is a provider boundary.

Meta-specific protocol details must not leak into the core content domain.

---

# 5. Explicit Non-Goals

The current Meta integration does not define:

- Messenger conversation automation;
- lead-generation workflows;
- ratings/reviews;
- broad Meta analytics;
- advertising APIs;
- Instagram-specific business workflows;
- arbitrary Meta object management;
- AI-generated response text;
- full conversation/thread persistence;
- multi-provider webhook persistence;
- the v1.3 `webhook_endpoints` aggregate;
- provider-aware `external_interactions` natural-key migration;
- Meta-specific analytics read models.

These may be introduced by later specifications.

They must not be added implicitly to the current DB v1.2 contract.

---

# 6. Architectural Invariants

The following invariants are mandatory.

## 6.1 PostgreSQL is the System of Record

All durable business state and Meta integration history are authoritative in PostgreSQL.

Redis/BullMQ is an asynchronous execution layer only.

A queue loss, worker restart, or Redis restart must not destroy authoritative business state.

## 6.2 Transactional Outbox

Any durable state transition that produces an asynchronous side effect must create its `outbox_jobs` record in the same PostgreSQL transaction as the state transition.

Direct BullMQ enqueue from a durable-write hot path is prohibited.

## 6.3 Fail Closed

The Meta boundary must reject or quarantine:

- invalid signatures;
- malformed mandatory structure;
- unresolved destination where downstream processing requires it;
- unavailable mandatory credentials;
- structurally invalid configuration;
- unsupported operations where the provider contract has not been validated.

## 6.4 Idempotency

Meta webhooks are at-least-once external input.

Duplicate delivery must not create duplicate domain interactions or duplicate side effects.

Outbound asynchronous work uses deterministic job identities.

Materialized external entities use database-enforced natural identities.

## 6.5 Reconciliation

Every outbound Meta operation whose final external outcome may become uncertain must have a reconciliation path.

A network timeout must never be treated as proof that the external operation failed.

## 6.6 Provider Isolation

Core domain services must not depend on raw Meta Graph API request or response structures.

Meta-specific behavior belongs behind Meta services and adapters.

## 6.7 Auditability

The platform must retain enough information to reconstruct:

- what Meta sent;
- when it was received;
- how it was validated;
- how it was processed;
- which domain entity it created or affected;
- which outbound operation was attempted;
- which credential/configuration was applicable;
- and how an uncertain external outcome was reconciled.

---

# 7. Integration Boundary Model

Meta integration has three explicit operational directions.

## 7.1 Inbound webhook

```text
Meta Platform
      |
      v
Webhook Ingress
      |
      v
WebhookEvent
      |
      v
Webhook Processing
      |
      v
ExternalInteraction
      |
      v
Interaction Policy
      |
      v
InteractionResponse
```

## 7.2 Outbound publication

```text
PublicationScheduler
      |
      v
content.publish
      |
      v
ContentPublishWorker
      |
      v
ContentPublishService
      |
      v
MetaPublisherAdapter
      |
      v
Meta Graph API
      |
      v
Publication state
```

## 7.3 Outbound interaction response

```text
ExternalInteraction
      |
      v
Response Policy
      |
      v
Moderation Gate
      |
      v
InteractionResponse
      |
      v
webhook.respond
      |
      v
WebhookRespondWorker
      |
      v
MetaInteractionAdapter
      |
      v
Meta Graph API
      |
      v
Response state / reconciliation
```

`MetaPublisherAdapter` and `MetaInteractionAdapter` are separate provider boundaries and must not be merged.

This separation is normative.

---

# 8. Provider Model

A Meta Page is represented internally as a `destination`.

The external Page ID is provider-specific identity and must not become an internal primary key.

```text
Meta Page ID
     |
     v
destinations.external_id
     |
     v
internal destination.id
```

The Meta provider must therefore resolve:

```text
provider identity
        ↓
destination
        ↓
internal domain identity
```

The same rule applies to external post and interaction identifiers.

---

# 9. Webhook Ingress

## 9.1 Endpoints

```text
POST /api/v1/webhooks/meta
GET  /api/v1/webhooks/meta
```

The POST endpoint receives Meta webhook events.

The GET endpoint performs Meta `hub.challenge` verification.

## 9.2 Ingress responsibilities

The HTTP handler is deliberately lightweight.

It is responsible for:

1. reading the raw HTTP body;
2. verifying `X-Hub-Signature-256`;
3. validating the webhook envelope;
4. resolving the destination context;
5. constructing the deterministic idempotency key;
6. durably persisting the event;
7. inserting the `webhook.process` outbox job;
8. returning the HTTP response.

Heavy business processing is prohibited on the HTTP hot path.

## 9.3 Raw-body signature verification

Signature verification is performed against the original request bytes.

```text
raw HTTP body
     |
     v
HMAC-SHA256(META_APP_SECRET, raw_body)
     |
     v
constant-time comparison
```

JSON re-serialization must never be used to calculate the signature.

Invalid or malformed signatures fail closed.

No `webhook_events` row is created for a rejected signature.

## 9.4 Envelope validation

The ingress validates the webhook envelope.

The initial supported envelope is:

```typescript
{
  object: "page",
  entry: [
    {
      id: string,
      time: number,
      changes: [
        {
          field: string,
          value: Record<string, unknown>
        }
      ]
    }
  ]
}
```

Unknown `field` values are not automatically ingress failures. Unsupported fields are handled by the processing layer.

## 9.5 Ingress transaction boundary

Destination resolution is performed **before** the transaction as a read-only operation. The resolved destination identifier participates in the transactional write.

The normative transaction boundary is:

```text
resolve destination (read-only, outside the transaction)

BEGIN
  |
  +-- INSERT webhook_events
  |     (destination_id is nullable; see §10)
  |
  +-- INSERT outbox_jobs
  |
COMMIT
  |
HTTP success
```

The webhook event and its processing job must be atomically persisted.

If the destination cannot be resolved at ingress time, the webhook event MAY be persisted without a destination reference, because some provider ingress modes legitimately produce unresolvable object identifiers (for example, Meta test events delivered with a test object identifier). Downstream processing MUST fail closed where destination context is required (see §42).

No durable acceptance decision may depend on a database operation that is outside that transaction boundary.

## 9.6 Redis isolation

No Redis/BullMQ operation is required for durable webhook acceptance.

Redis availability must not determine whether an already valid external event can be durably accepted.

## 9.7 Duplicate delivery

The ingress uses:

```text
webhook_events.idempotency_key
```

as the database-enforced duplicate boundary.

The current v0.9.0 platform contract defines the initial implementation as:

```text
idempotency_key = sha256(provider || raw_body_hash)
```

where `raw_body_hash` is the SHA-256 digest of the raw HTTP body.

Duplicate delivery:

```text
INSERT ... ON CONFLICT DO NOTHING
```

must result in:

- no duplicate `webhook_events`;
- no duplicate `outbox_jobs`;
- successful external HTTP acknowledgement.

## 9.8 GET handshake

The verification flow is:

```text
GET /api/v1/webhooks/meta
        |
        v
resolve active Meta subscription
        |
        v
decrypt protected verify token
        |
        v
constant-time comparison
        |
   +----+----+
   |         |
 valid     invalid
   |         |
challenge   403
```

Successful verification may update subscription verification metadata and create the corresponding audit record.

The handshake does not create a `webhook_events` row.

---

# 10. Webhook Event Persistence

`webhook_events` represents the durable external fact:

> Meta delivered this event to the platform.

The raw event payload is immutable after receipt.

Operational processing state is mutable independently of the immutable payload.

Conceptual fields include:

| Field                | Purpose                         |
| -------------------- | ------------------------------- |
| `id`                 | internal UUID                   |
| `provider`           | `META`                          |
| `destination_id`     | resolved destination (nullable) |
| `object_type`        | provider object type            |
| `external_object_id` | Meta object/Page identity       |
| `field`              | `feed`, `mention`, etc.         |
| `idempotency_key`    | duplicate-delivery identity     |
| `raw_payload`        | persisted event payload         |
| `raw_body_hash`      | raw-body SHA-256                |
| `signature_verified` | verification result             |
| `status`             | processing state                |
| `trace_id`           | correlation                     |
| `received_at`        | ingress timestamp               |
| `processed_at`       | processing completion           |

The exact physical schema remains governed by `DATABASE_SCHEMA_CONTRACT.md` v1.2.

---

# 11. Webhook Processing

## 11.1 Worker

The `webhook.process` queue is consumed by:

```text
WebhookProcessWorker
        |
        v
WebhookProcessService
```

The worker receives identifiers only.

Example conceptual payload:

```json
{
  "webhookEventId": "..."
}
```

Full provider documents are not placed into queue payloads.

## 11.2 Processing flow

```text
Load webhook_events
        |
        v
guard lifecycle state
        |
        v
claim PROCESSING
        |
        v
create webhook_deliveries attempt
        |
        v
parse entries and changes
        |
        v
select ChangeExtractor
        |
        v
materialize ExternalInteraction
        |
        v
persist outcome
        |
        v
PROCESSED / FAILED / DEAD_LETTER
```

## 11.3 Extractor registry

Current extractors:

```text
feed     → FeedChangeExtractor
mention  → MentionChangeExtractor
```

The registry must remain extensible.

Provider-specific parsing must not be scattered through the worker.

## 11.4 Unsupported fields

An unsupported webhook field is recorded as an unsupported-field outcome and is skipped safely unless a future contract explicitly makes that field mandatory.

Unknown provider fields must not break otherwise valid webhook processing.

## 11.5 Interaction materialization

The processing worker materializes:

```text
COMMENT
REACTION
MENTION
```

as `external_interactions`.

The interaction domain is independent from the `ContentItem` lifecycle.

## 11.6 Processing idempotency

A worker retry must not create duplicate interactions.

The database natural identity is currently:

```text
(interaction_type, external_interaction_id)
```

Provider-aware natural-key evolution is intentionally deferred to a future DB version (see §48).

---

# 12. External Interaction Domain

`external_interactions` is a first-class domain entity.

It is not a `ContentItem`.

It is not a publication.

It is not a response.

Conceptual fields:

| Field                     | Purpose                           |
| ------------------------- | --------------------------------- |
| `id`                      | internal UUID                     |
| `webhook_event_id`        | provenance                        |
| `destination_id`          | destination                       |
| `publication_id`          | optional related publication      |
| `external_interaction_id` | external identity                 |
| `interaction_type`        | COMMENT / REACTION / MENTION      |
| `actor_external_id`       | external actor                    |
| `actor_display_name`      | supplied display name             |
| `content`                 | interaction text where applicable |
| `parent_external_id`      | provider parent identity          |
| `permalink`               | external URL where supplied       |
| `occurred_at`             | external event time               |
| `raw_metadata`            | provider-specific metadata        |

The relationship to publication is deliberately weak:

```text
ExternalInteraction
      |
      +-- destination_id
      |
      +-- publication_id (optional)
```

Deleting or changing a publication must not destroy the external interaction fact.

The DB contract therefore uses the appropriate nullable/set-null relationship.

---

# 13. Publication Correlation

Inbound interaction processing may resolve an interaction to an existing publication through the external post identity.

The current DB v1.2 contract provides the required lookup:

```text
publications.external_post_id
```

with the corresponding partial index.

Conceptually:

```text
Meta external post ID
        |
        v
publications.external_post_id
        |
        v
publication.id
        |
        v
external_interactions.publication_id
```

The relationship is optional.

An interaction may exist without a known publication.

---

# 14. Interaction Response Domain

Interaction responses have a dedicated domain and persistence model.

They must not reuse the publication domain merely for structural convenience.

Dedicated persistence includes:

```text
interaction_responses
interaction_response_attempts
interaction_moderation_actions
interaction_response_reconciliations
```

The response lifecycle is independent from publication lifecycle.

---

# 15. Response Policy

An inbound interaction does not automatically imply an outbound response.

The policy layer determines:

```text
AUTO_RESPOND
MODERATION_REQUIRED
REJECTED
```

The policy engine must remain independent from the Meta adapter.

The Meta adapter must never decide whether a response is permitted.

## 15.1 Configuration

The intended authoritative configuration source is the platform configuration layer:

```text
system_config
     |
     v
ConfigService
     |
     v
DynamicConfigCache
     |
     +-- interaction response rules
     +-- response templates
     +-- rate-limit configuration
     +-- response enable/disable gate
```

The runtime uses the platform configuration layer as the authoritative source.

Permanent hard-coded defaults must not replace the dynamic configuration contract.

---

# 16. Response Templates

Response templates are deterministic configuration-driven content.

The initial DB v1 contract stores template/rule configuration through the platform configuration layer.

AI-generated response text is outside the current DB v1 contract.

Templates must therefore remain:

- versionable through configuration changes;
- auditable;
- provider-neutral at the domain layer;
- rendered before provider-specific execution.

---

# 17. Moderation Gate

Where policy requires moderation:

```text
ExternalInteraction
        |
        v
Response Candidate
        |
        v
MODERATION_REQUIRED
        |
        +---- APPROVE ----+
        |                 |
        +---- EDIT -------+
        |                 |
        +---- REJECT      |
                          v
                    executable response
```

Moderation actions are persisted in:

```text
interaction_moderation_actions
```

Supported actions include:

```text
APPROVE
REJECT
EDIT
ESCALATE
```

Editing requires revalidation before execution.

Interaction-response moderation history is intentionally separate from publication moderation history.

---

# 18. Interaction Response State Machine

The current durable contract is:

```text
DRAFT
  |
  +--------------------------+
  |                          |
  v                          v
AUTO_RESPOND          MODERATION_REQUIRED
  |                          |
  |                    +-----+------+
  |                    |            |
  |                 APPROVED     REJECTED
  |                    |
  |                  EDITED
  |                    |
  +----------------> SCHEDULED
                       |
                       v
                    execution
                       |
             +---------+---------+
             |                   |
         RESPONDED            UNKNOWN
                                 |
                          RECONCILIATION
                                 |
                    +------------+------------+
                    |                         |
                RESPONDED               RETRY_ELIGIBLE
                    |                         |
                    |                    retry execution
                    |
                terminal
```

The physical database contract currently persists the states supported by DB v1.2; the application layer owns legal transitions.

The distinction between:

```text
business decision
execution
external outcome
reconciliation
```

must remain explicit.

---

# 19. Interaction Response Execution

The worker is:

```text
WebhookRespondWorker
        |
        v
WebhookRespondService
        |
        v
MetaInteractionAdapter
```

The execution sequence is conceptually:

```text
1. Load interaction_response.
2. Guard executable state.
3. Atomically claim execution.
4. Create interaction_response_attempts row.
5. Apply response rate-limit guard.
6. Retrieve credential through MetaCredentialService.
7. Call Meta Graph API through MetaInteractionAdapter.
8. Normalize provider result.
9. Persist final/uncertain state.
10. Schedule reconciliation where required.
```

The response worker, service, adapter, attempt history and reconciliation mechanisms operate according to the runtime configuration and rate-limit contracts defined by this specification.

---

# 20. MetaInteractionAdapter

`MetaInteractionAdapter` is the provider boundary for interaction responses.

Conceptual operations:

```text
replyToComment(...)
reconcileReply(...)
```

The adapter owns:

- Graph API request construction;
- Meta authentication;
- Meta external IDs;
- provider error parsing;
- HTTP transport;
- provider response normalization;
- Meta-specific response rate limiting.

The adapter does not own:

- response policy;
- moderation;
- business approval;
- domain scheduling;
- domain state transitions.

The adapter must return normalized platform results.

Raw Meta response structures must not leak into the core domain.

---

# 21. Publication Domain Boundary

Outbound publication remains part of the publication domain.

The Meta publisher path is:

```text
Publication
      |
      v
PublicationScheduler
      |
      v
content.publish
      |
      v
ContentPublishWorker
      |
      v
ContentPublishService
      |
      v
MetaPublisherAdapter
      |
      v
Meta Graph API
```

`MetaPublisherAdapter` remains independent from `MetaInteractionAdapter`.

---

# 22. Publication Scheduler

The current scheduler is a durable-state-driven polling service.

Configuration:

```text
PUBLICATION_SCHEDULE_INTERVAL_MS
PUBLICATION_SCHEDULE_BATCH_SIZE
PUBLICATION_RECONCILE_STALE_THRESHOLD_SECONDS
```

The scheduler uses chained `setTimeout` execution rather than overlapping `setInterval` ticks.

## 22.1 Due publication scan

The scheduler atomically claims due publications:

```text
SCHEDULED
    |
    v
atomic claim
    |
    v
RESERVED
    |
    v
content.publish
```

The claim is protected against concurrent scheduler instances using transactional PostgreSQL locking, including `FOR UPDATE SKIP LOCKED`.

The state change and corresponding outbox enqueue occur in the same PostgreSQL transaction.

## 22.2 Stale reconciliation scan

The scheduler also scans stale `RECONCILIATION` publications.

It atomically touches the reconciliation candidate and enqueues:

```text
publication.reconcile:{publicationId}:{epoch}
```

The staleness threshold prevents uncontrolled duplicate reconciliation enqueues.

## 22.3 Scheduler Credential Health Gate

Before a scheduled publication is reserved for outbound dispatch, the scheduler MUST evaluate credential health for the destination through the authoritative credential service.

The normative behavior is:

```text
PublicationScheduler
        |
        v
MetaCredentialService.healthCheck(destinationId)
        |
        +-------------------+
        |                   |
     INVALID            VALID/EXPIRING
        |                   |
        v                   v
remain SCHEDULED       continue claim/enqueue
```

If the credential health check is valid, the scheduler MAY perform the contractual reservation and enqueue the outbound job.

If credential health is invalid or cannot be established, the publication MUST remain in a non-dispatched scheduled state and MUST NOT be enqueued as executable outbound work.

The scheduler must not introduce a new publication state solely for credential pause.

---

# 23. Publication Execution State

The current publication execution model includes:

```text
SCHEDULED
    |
    v
RESERVED
    |
    v
external execution
    |
    +------> PUBLISHED
    |
    +------> RETRY
    |
    +------> FAILED
    |
    +------> RECONCILIATION
```

The exact physical publication state vocabulary remains governed by `DATABASE_SCHEMA_CONTRACT.md` v1.2 and the current repository implementation.

`RESERVED` is part of the publication state vocabulary defined by `DATABASE_SCHEMA_CONTRACT.md` v1.2. The scheduler uses it as the atomic pre-execution claim state before enqueueing `content.publish`.

A worker must accept the scheduler's reserved state.

---

# 24. Publication Reconciliation

Publication reconciliation is a required part of the outbound Meta path.

The current implementation contains:

```text
PublicationReconcileWorker
        |
        v
PublicationReconcileService
        |
        v
MetaPublicationReconciler
        |
        v
Meta Graph API
```

## 24.1 Primary success path

The preferred path is:

```text
Meta publication request
        |
        v
provider success
        |
        v
publication attempt SUCCESS
        |
        v
publication PUBLISHED
        |
        v
external_post_id
```

## 24.2 Uncertain outcome

A timeout or ambiguous transport failure enters:

```text
UNKNOWN / RECONCILIATION
```

rather than being interpreted automatically as failure.

The reconciler queries an authoritative Meta signal and determines whether the publication exists.

## 24.3 Reconciliation outcomes

The current architecture distinguishes:

```text
PUBLISHED
RETRY_ELIGIBLE
STILL_UNKNOWN
```

or their equivalent application-level outcomes.

A publication with no attempt record is treated as a data-integrity failure, not as an ordinary provider uncertainty.

---

# 25. Push and Pull Reconciliation

## 25.1 Interaction response push reconciliation

The preferred response reconciliation path is inbound:

```text
Meta
  |
  v
feed webhook
  |
  v
webhook.process
  |
  v
match response identity
  |
  v
RESPONDED
```

The response can be matched using destination and external response identity where available.

## 25.2 Pull reconciliation

Pull reconciliation is a bounded fallback.

It may query the Meta Graph API when push evidence is insufficient.

Pull reconciliation must never become an unbounded polling loop.

All reconciliation results are durable.

---

# 26. Credentials

## 26.1 Credential types

The Meta integration may require:

```text
APP_ID
APP_SECRET
PAGE_ACCESS_TOKEN
SYSTEM_USER_TOKEN
WEBHOOK_VERIFY_TOKEN
```

The exact credential required is determined by the provider operation and configured capability.

## 26.2 Storage

Provider secrets must never be stored in plaintext in ordinary application tables.

The current architecture is:

```text
MetaCredentialService
        |
        v
CredentialEncryptionProvider
        |
        v
AES-256-GCM
```

## 26.3 Encryption

The current technical baseline specifies:

```text
AES-256-GCM
32-byte key
12-byte random IV
16-byte authentication tag
AAD:
provider || ":" || credential_type || ":" || (destination_id ?? "app")
```

Encrypted values carry a key-version prefix.

The AAD binds encrypted credentials to their provider, credential type and destination context.

## 26.4 Key rotation

Multiple encryption-key versions may coexist.

Rules:

- new writes use the active key version;
- reads use the version stored with the credential;
- rotation is progressive;
- credential values are never exposed through ordinary logs.

## 26.5 Credential lifecycle

Required service capabilities:

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

Health states:

```text
VALID
EXPIRING
INVALID
UNKNOWN
```

`INVALID` is sticky until successful validation or rotation.

## 26.6 Credential cache

A short-lived per-process credential cache may reduce repeated decryption.

The cache must be invalidated when credentials are:

- rotated;
- explicitly invalidated;
- changed;
- expired from cache TTL.

No cache may become authoritative credential state.

## 26.7 Runtime integration

The final outbound runtime must retrieve the Page Access Token through `MetaCredentialService`.

The runtime must not use an environment-token shortcut in place of the credential service for production provider execution.

## 26.8 Credential Runtime Authority

All outbound Meta operations MUST obtain provider credentials through the authoritative credential service and MUST NOT bypass that authority through an independent runtime credential source.

Credential health and validity MUST be evaluated according to the credential service contract before an outbound operation is permitted to proceed.

---

# 27. Credential Health and Scheduler Interaction

Credential health affects outbound scheduling.

Normative behavior:

```text
healthCheck(destination)
        |
        +---- INVALID ----> do not enqueue content.publish
        |
        +---- VALID ------> continue
        |
        +---- EXPIRING ---> continue subject to policy
        |
        +---- UNKNOWN ----> fail closed where credential availability
                            is mandatory
```

A credential failure discovered immediately before an external call must not be hidden.

The adapter must return a normalized credential/authentication error and the domain must transition to the appropriate retry/reconciliation state.

---

# 28. Credential Invalidation Webhooks

A provider token-invalidated event may be received from Meta.

The webhook processing path must handle such events thinly:

```text
record external event
        |
        v
generate operational notification
        |
        v
audit
```

It must not perform credential rotation directly in the webhook worker.

Credential lifecycle operations remain owned by `MetaCredentialService`.

---

# 29. Error Taxonomy

Meta-specific errors are normalized into platform-level categories.

At minimum:

```text
AUTHENTICATION_ERROR
AUTHORIZATION_ERROR
RATE_LIMIT
VALIDATION_ERROR
NOT_FOUND
CONFLICT
NETWORK_ERROR
TIMEOUT
TRANSIENT_ERROR
PROVIDER_ERROR
UNKNOWN_ERROR
```

The existing platform technical specification also distinguishes provider classes such as temporary server errors, invalid requests and content rejection.

`MetaErrorMapper` is the authoritative normalization boundary.

Error classification determines:

- retry;
- permanent failure;
- reconciliation;
- credential invalidation;
- operator notification.

A timeout after a request may have reached Meta is never automatically classified as a definitive failure.

---

# 30. Rate Limiting

Meta outbound operations require scoped rate limiting.

The architecture must support:

```text
provider
destination/Page
credential
operation
queue
```

## 30.1 Publication limits

Publication controls include:

```text
per-destination limit
global limit
daily limit
minimum interval
```

## 30.2 Interaction response limits

Interaction responses have a separate rate-limit domain.

The current configuration contract includes:

```text
interaction_response.max_per_hour_per_destination
interaction_response.min_interval_seconds
interaction_response.global_max_per_hour
```

The intended enforcement layers are:

```text
1. policy-level pre-filter
2. queue/scheduling enforcement
3. adapter-level final guard
```

The production enforcement path must not use a no-op limiter. All applicable limits are effective at the policy, scheduling/queue and final provider execution boundaries defined by this specification.

## 30.3 Rate-Limit Enforcement Contract

Meta rate limits MUST be enforced at runtime and MUST NOT be represented only as advisory policy metadata.

Where the platform defines a rate limit, enforcement MUST prevent dispatch when the operation would violate the applicable limit. The enforcement model MAY use policy evaluation, queue/scheduling control, and provider-adapter enforcement as appropriate, but the effective runtime behavior MUST preserve the configured limit under concurrent execution and retry.

A no-op limiter MAY exist as a test or explicitly non-production implementation, but production execution MUST NOT treat a no-op limiter as satisfying the Meta rate-limit contract.

---

# 31. Configuration and Kill Switches

The Meta outbound paths are controlled by configuration.

The platform-level publication gate is:

```text
publication.enabled
```

The interaction-response gate is:

```text
responses.enabled
```

When publication is disabled:

- inbound webhook ingestion continues;
- webhook processing continues;
- interaction materialization continues;
- outbound publication does not execute;
- outbound interaction responses are gated according to response policy.

When responses are disabled:

- inbound webhook ingestion continues;
- interaction materialization continues;
- response execution does not enqueue new outbound response work.

Configuration changes must be auditable.

---

# 32. Outbox Integration

The Meta integration uses the platform-level `outbox_jobs` primitive.

The outbox is deliberately generic:

```text
domain transaction
      |
      v
outbox_jobs
      |
      v
OutboxDispatcher
      |
      v
BullMQ
      |
      v
worker
```

The outbox table has no foreign keys.

Queue payloads contain identifiers and operational parameters, not:

- full provider payloads;
- documents;
- credentials;
- secrets.

Deterministic `job_id` values are mandatory.

---

# 33. Meta Queue Contracts

Current Meta-related queues include:

```text
webhook.process
webhook.respond
webhook.respond.reconcile
content.publish
publication.reconcile
```

Credential lifecycle may additionally use:

```text
meta.credential.refresh
```

The queue is not the system of record.

Each worker must be able to recover its durable work from PostgreSQL.

---

# 34. Worker Responsibilities

## 34.1 WebhookProcessWorker

Responsible for:

- loading durable webhook event;
- claiming processing;
- invoking extractors;
- materializing interactions;
- recording processing outcome.

It does not call the Meta Graph API for ordinary webhook materialization.

## 34.2 WebhookRespondWorker

Responsible for:

- loading response;
- claiming executable response;
- creating attempt;
- enforcing response execution guards;
- invoking `MetaInteractionAdapter`;
- persisting result.

## 34.3 WebhookRespondReconcileWorker

Responsible for:

- investigating UNKNOWN/stale response execution;
- invoking reconciliation;
- persisting reconciliation result.

## 34.4 ContentPublishWorker

Responsible for:

- loading publication;
- validating executable state;
- invoking `ContentPublishService`;
- calling `MetaPublisherAdapter` through the service boundary;
- persisting attempt/result.

## 34.5 PublicationReconcileWorker

Responsible for:

- investigating uncertain publication outcomes;
- invoking `MetaPublicationReconciler`;
- persisting reconciliation result.

## 34.6 PublicationSchedulerWorker

Responsible for:

- finding due scheduled publications;
- atomically claiming them;
- enqueueing publication work through the outbox;
- finding stale reconciliation candidates;
- triggering bounded reconciliation work.

The scheduler does not directly call Meta.

---

# 35. Concurrency and Atomicity

The Meta integration is designed for multiple worker and scheduler instances.

Required controls include:

```text
FOR UPDATE SKIP LOCKED
atomic guarded UPDATE
deterministic job_id
database uniqueness
monotonic timestamps
state guards
transactional outbox
```

## 35.1 Publication claim

The scheduler must atomically transition a publication from its claimable state to `RESERVED`.

Only the successful claimant may enqueue the corresponding publication job.

## 35.2 Response execution claim

A response must be atomically claimed before external execution.

Multiple workers must not execute the same response concurrently.

## 35.3 Reconciliation claim

Stale reconciliation work must be bounded by a database-side claim/touch operation and a staleness threshold.

The same external uncertainty must not generate uncontrolled reconciliation storms.

---

# 36. Idempotency Layers

The Meta integration uses multiple idempotency layers.

## Layer 1 — Inbound event

```text
webhook_events.idempotency_key
```

## Layer 2 — Materialized interaction

```text
(interaction_type, external_interaction_id)
```

## Layer 3 — Asynchronous work

```text
outbox_jobs.job_id
BullMQ jobId
```

## Layer 4 — Outbound attempts

Interaction response attempts use:

```text
(response_id, attempt_number)
```

and retain:

```text
request_payload_hash
```

for deterministic request correlation.

## Layer 5 — Publication claim

Publication execution uses an atomic state claim before external execution.

## Layer 6 — Reconciliation

Reconciliation is bounded by durable state, claim/touch semantics and staleness thresholds.

---

# 37. Audit and Observability

Every relevant asynchronous Meta operation should be traceable through:

```text
trace_id
job_id
domain_entity_id
provider
destination_id
operation
attempt_number
```

The platform retains specialized durable history in:

```text
webhook_deliveries
publication_attempts
publication_reconciliations
interaction_response_attempts
interaction_response_reconciliations
config_audit_log
audit_logs
system_logs
```

## 37.1 Audit trail semantics

Specialized attempt and reconciliation records provide operation-specific history. Normative state transitions that are required to be centrally auditable also produce the corresponding `audit_logs` record. Specialized history and central audit history are complementary and must not be treated as interchangeable.

---

# 38. Security Requirements

Mandatory:

- HTTPS outside local development;
- HMAC-SHA256 webhook signature verification;
- constant-time signature/token comparison;
- fail-closed validation;
- encrypted provider credentials;
- protected webhook verify tokens;
- no secrets in source control;
- no secrets in ordinary logs;
- bounded request size;
- endpoint-level rate limiting;
- credential lifecycle auditability;
- controlled credential rotation.

Secrets include:

```text
Meta App Secret
Page Access Token
System User Token
Webhook Verify Token
credential encryption keys
```

No secret may appear in:

- source control;
- queue payloads;
- ordinary logs;
- audit payloads;
- error messages returned to external clients.

Any credential exposed outside its controlled secret store must be considered compromised and rotated before production use.

---

# 39. API Versioning

The Meta Graph API version is configuration-driven.

It must not be hard-coded throughout domain logic.

A Graph API version change requires:

1. compatibility review;
2. webhook payload compatibility testing;
3. outbound contract testing;
4. staging validation;
5. controlled configuration rollout;
6. E2E validation where external behavior is affected.

Webhook parsing must tolerate irrelevant/additional provider fields.

Mandatory fields remain fail-closed.

---

# 40. Testing Contract

## 40.1 Unit tests

Required:

- signature verification;
- handshake;
- envelope validation;
- idempotency-key generation;
- error mapping;
- extractor behavior;
- state transitions;
- retry classification;
- credential lifecycle;
- rate-limit decisions;
- policy behavior;
- template rendering.

## 40.2 Integration tests

Required:

- webhook persistence;
- single-transaction ingress;
- transactional outbox;
- duplicate delivery;
- worker processing;
- interaction materialization;
- response persistence;
- moderation persistence;
- credential retrieval;
- publication scheduling;
- publication claim concurrency;
- reconciliation;
- stale recovery.

## 40.3 Provider contract tests

Required for Meta adapters:

- request construction;
- authentication;
- endpoint selection;
- Graph API version;
- error normalization;
- successful result normalization;
- ambiguous transport handling;
- reconciliation lookup.

## 40.4 Real Meta E2E

Inbound:

```text
Meta
  -> webhook ingress
  -> PostgreSQL
  -> outbox
  -> BullMQ
  -> WebhookProcessWorker
  -> ExternalInteraction
```

Response:

```text
ExternalInteraction
  -> policy
  -> moderation
  -> response
  -> MetaInteractionAdapter
  -> Meta Graph API
  -> reconciliation
```

Publication:

```text
Publication
  -> scheduler
  -> outbox
  -> BullMQ
  -> ContentPublishWorker
  -> MetaPublisherAdapter
  -> Meta Graph API
  -> publication state
```

The established implementation has demonstrated real inbound and outbound publication E2E paths. These paths are regression evidence for the contract.

---

# 41. Replay Fixtures

Fixtures must be maintained under:

```text
tests/fixtures/meta/webhooks/
```

Required fixture classes:

- feed comment;
- feed reaction;
- mention;
- duplicate delivery;
- malformed envelope;
- unknown field;
- out-of-order event;
- invalid signature;
- credential invalidation event;
- provider rate limit;
- provider 5xx;
- ambiguous timeout.

Fixtures must retain relevant Graph API version metadata.

---

# 42. Failure Matrix

Failure handling is part of the Meta integration contract. The required behavior is defined below; the matrix does not prescribe additional components beyond the established architecture.

| Failure condition                                        | Required system behavior                                                                                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invalid webhook signature                                | Reject at the HTTP boundary; no durable event is created.                                                                                                |
| Malformed webhook envelope                               | Reject at the HTTP boundary; no invalid domain event is persisted.                                                                                       |
| Duplicate webhook event                                  | Absorb idempotently; no duplicate interaction is materialized.                                                                                           |
| Unknown destination                                      | Fail closed and prevent outbound processing for the unresolved destination.                                                                              |
| Unsupported webhook field                                | Ignore safely unless the field is required for valid interpretation.                                                                                     |
| Malformed change value                                   | Isolate the invalid change according to extractor semantics without corrupting valid changes.                                                            |
| PostgreSQL transaction rollback                          | No state change or outbox job from the rolled-back transaction is considered committed.                                                                  |
| Webhook persisted but not dispatched                     | Durable outbox state remains recoverable by the dispatcher/recovery mechanism.                                                                           |
| Webhook PROCESSING abandoned                             | Recover stale processing state according to the recovery contract.                                                                                       |
| Worker crash                                             | Durable state remains recoverable; processing must not create duplicate domain effects.                                                                  |
| Redis/BullMQ unavailable                                 | PostgreSQL remains authoritative; durable work remains recoverable from the outbox.                                                                      |
| Outbox claim collision                                   | Database locking prevents concurrent dispatchers from processing the same claimed row.                                                                   |
| BullMQ enqueue outcome uncertain                         | Outbox recovery must preserve eventual dispatch without silently losing the durable job.                                                                 |
| Meta 401                                                 | Treat as credential/authentication failure; invalidate or reclassify credential health as required and prevent unsafe continuation.                      |
| Meta 403                                                 | Treat as authorization failure; record the failed attempt and prevent unsafe retry where the error is non-retryable.                                     |
| Meta 429                                                 | Respect provider rate limiting and retry according to the applicable rate-limit policy.                                                                  |
| Meta 5xx                                                 | Treat as transient provider failure and retry/reconcile according to operation semantics.                                                                |
| Network timeout after request                            | Mark the external outcome UNKNOWN where the request may have reached Meta; reconcile before treating the operation as failed or retryable.               |
| Malformed provider success response                      | Do not infer success from an invalid response; preserve the attempt and reconcile when external state is uncertain.                                      |
| Out-of-order webhook event                               | Do not regress materialized interaction state when the event is older than the authoritative state.                                                      |
| Duplicate interaction response attempt                   | Atomic execution guard permits only one winning attempt for the response transition.                                                                     |
| Response template missing required value                 | Fail closed; do not send a malformed response.                                                                                                           |
| Response moderation rejection                            | Persist the moderation decision and terminate the response path without provider execution.                                                              |
| Interaction response rate limit exceeded                 | Do not execute immediately; apply the configured policy/queue behavior.                                                                                  |
| Publication rate limit exceeded                          | Do not execute immediately; apply the configured scheduling/queue behavior.                                                                              |
| Credential decryption failure                            | Fail closed; no provider request is attempted with unavailable or untrusted credentials.                                                                 |
| Credential rotation                                      | New credential becomes authoritative only through the credential lifecycle contract; cache state is invalidated accordingly.                             |
| Credential invalidation                                  | Prevent further unsafe outbound execution until a valid credential is available.                                                                         |
| Publication claim race                                   | Atomic claim semantics permit only one worker to own the execution transition.                                                                           |
| Duplicate scheduler tick                                 | Scheduler concurrency controls prevent duplicate execution claims.                                                                                       |
| Stale reconciliation work                                | Reconciliation claim semantics prevent conflicting concurrent reconciliation.                                                                            |
| Reconciliation remains UNKNOWN                           | Keep the operation in the defined uncertain/reconciliation state and continue bounded reconciliation according to policy.                                |
| DEAD_LETTER event                                        | Preserve the durable failure state and expose it to the defined recovery/operational process.                                                            |
| System recovery/rebuild failure                          | Do not fabricate successful state; retain authoritative PostgreSQL state and surface the recovery failure operationally.                                 |
| Destination deleted or becomes unavailable after receipt | Durable webhook/event state MUST remain recoverable; processing MUST fail closed and MUST NOT dispatch an outbound response without a valid destination. |

---

# 43. Recovery Model

The recovery model is PostgreSQL-first.

## 43.1 Webhook processing recovery

A stale `PROCESSING` event can be returned to a recoverable state and reprocessed according to the system recovery policy.

## 43.2 Outbox dispatch recovery

A stale `DISPATCHING` outbox record can be returned to `PENDING`.

The deterministic BullMQ `job_id` prevents duplicate logical work.

## 43.3 Publication recovery

A stale publication in `RECONCILIATION` is picked up by the publication scheduler and reconciled through the Meta provider.

## 43.4 Response recovery

An UNKNOWN or stale response is picked up by the response reconciliation worker.

## 43.5 System rebuild

A durable-state-driven `system.rebuild` operation reconstructs recoverable execution state from authoritative PostgreSQL state. It is distinct from stale outbox dispatch recovery and must not fabricate domain success.

---

# 44. Operational Cleanup

The platform performs retention-based cleanup of old `DISPATCHED` outbox records. Cleanup must never remove `PENDING` or active `DISPATCHING` work and must respect the configured retention window. The cleanup mechanism may use the established operational execution model; its required property is preservation of durable work and deterministic retention behavior.

The final decision must preserve the functional invariant:

```text
PENDING       → retained
DISPATCHING   → retained
FAILED        → retained
DISPATCHED    → time-based retention
```

---

# 45. Data Retention

Retention must distinguish:

1. raw provider events;
2. webhook delivery attempts;
3. domain interactions;
4. response attempts;
5. publication attempts;
6. reconciliation history;
7. audit history;
8. configuration audit history.

Retention policies must not destroy provenance needed by active reconciliation.

Exact production retention periods remain operational policy unless separately specified.

---

# 46. Deployment Model

## 46.1 Local development

```text
Meta
  |
HTTPS tunnel
  |
apps/api
  |
PostgreSQL + Redis/BullMQ
```

A temporary HTTPS tunnel is acceptable for development/E2E testing.

## 46.2 Production

```text
Meta
  |
HTTPS
  |
reverse proxy / edge
  |
apps/api
  |
PostgreSQL + outbox + BullMQ
  |
workers
```

Ephemeral development tunnel URLs are never production webhook infrastructure.

---

# 47. Conformance and System Completeness

The Meta integration conforms to this specification when the established architecture and its runtime components collectively provide the behavior defined in this document.

The specification distinguishes **architectural capabilities** from their implementation details. The following capabilities form the current Meta system baseline and are not optional architectural concepts:

| Capability                          | Required system property                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| PostgreSQL persistence              | Durable Meta state is authoritative in PostgreSQL.                                            |
| Database migrations                 | The physical schema is reproducible from the authoritative migration chain.                   |
| Transaction management              | Atomic state changes use the established transaction boundary.                                |
| Transactional outbox                | Durable state transitions that require asynchronous execution are bridged through the outbox. |
| Outbox dispatch                     | Durable outbox work is claimed and dispatched without loss or unsafe duplication.             |
| BullMQ execution                    | Redis/BullMQ executes asynchronous work; it is not the system of record.                      |
| Worker model                        | Workers perform idempotent, claim-protected domain operations.                                |
| Publication attempts                | External publication attempts are durably recorded.                                           |
| Publication reconciliation          | Uncertain publication outcomes are reconciled.                                                |
| Interaction response attempts       | External response attempts are durably recorded.                                              |
| Interaction response reconciliation | Uncertain response outcomes are reconciled.                                                   |
| Credential encryption               | Provider credentials are encrypted, authenticated and key-versioned.                          |
| Credential service                  | Provider credentials are resolved through the credential lifecycle contract.                  |
| Runtime configuration               | Configured policy, templates, limits and kill switches are authoritative at runtime.          |
| Rate limiting                       | Publication and interaction response execution obey applicable limits.                        |
| Credential health gating            | Outbound execution respects credential health state.                                          |
| Operational recovery                | Durable work and domain state remain recoverable according to the recovery contract.          |

These capabilities describe the required system behavior. They do not imply new tables, queues, workers or services where the established architecture already provides the required capability.

## 47.1 Persistence baseline

The current DB v1.2 schema is the authoritative persistence baseline for this specification. The Meta specification does not add, remove or reinterpret physical tables. Persistence semantics are governed by `DATABASE_SCHEMA_CONTRACT.md` v1.2.

No failure-handling, reconciliation, rate-limiting or operational requirement in this document by itself constitutes a schema-change requirement. A schema change is valid only when the logical and physical persistence contracts are updated accordingly.

## 47.2 Runtime completeness

The runtime must make the required behavior effective across all applicable execution paths. A capability is not considered satisfied merely because an interface, service or database structure exists; the behavior must be enforced where the operation executes.

This requirement does not prescribe a particular implementation beyond the architectural contracts defined in this specification.

## 47.3 Regression requirement

Existing verified inbound and outbound Meta flows are regression requirements. Changes must preserve the established PostgreSQL, outbox, queue, worker, adapter and reconciliation semantics.

---

# 48. Future Schema Boundary (DB v1.3)

The current Meta specification is based on the DB v1.2 persistence contract. The following concepts remain outside the current v1.2 schema boundary:

```text
webhook_endpoints
multi-page Meta hardening
provider-aware external interaction identity
```

The current natural key for `external_interactions` remains:

```text
(interaction_type, external_interaction_id)
```

Any future provider-aware identity model requires corresponding updates to the logical model and database contract before implementation.

---

# 49. Implementation Dependency Contract

Implementation follows the established contract hierarchy:

```text
META_INTEGRATION_SPECIFICATION
          |
          v
LOGICAL_MODEL_SPECIFICATION
          |
          v
DATABASE_SCHEMA_CONTRACT
          |
          v
Drizzle schema
          |
          v
Migration
          |
          v
Repository
          |
          v
Service / state machine
          |
          v
Worker
          |
          v
Adapter
          |
          v
Integration test
          |
          v
E2E
```

The dependency order prevents implementation details from silently redefining domain identity or persistence semantics.

---

# 50. Acceptance Criteria

The Meta integration satisfies this specification when all applicable criteria below hold:

1. Webhook signatures are verified against the raw request body.
2. Webhook envelopes are validated before domain materialization.
3. Webhook persistence and required asynchronous work are transactionally consistent.
4. Duplicate webhook deliveries are absorbed idempotently.
5. External interactions are materialized independently from ContentItem identity.
6. Interaction responses follow policy, template and moderation rules.
7. Interaction response execution is idempotent and reconciliation-capable.
8. Publication scheduling and execution preserve atomic claim semantics.
9. Publication execution uses the applicable credential health and rate-limit rules.
10. Publication attempts and uncertain outcomes are durably reconciled.
11. PostgreSQL remains authoritative throughout asynchronous execution.
12. Redis/BullMQ outages do not destroy durable work.
13. Provider errors are normalized according to the Meta error taxonomy.
14. Credential material is never exposed through logs or error payloads.
15. Kill switches independently control publication and interaction response execution as specified.
16. Recovery operations do not fabricate domain success and preserve durable state.
17. Real Meta inbound and outbound paths remain compatible with the contract.

---

# 51. Final Architectural Position

The Meta integration is a provider boundary inside the Content Platform. It is not a standalone Meta bot and does not redefine the core content domain.

```text
CONTENT DOMAIN
      |
      +--------------------------+
      |                          |
      v                          v
 PUBLICATION DOMAIN       INTERACTION DOMAIN
      |                          |
      v                          v
MetaPublisherAdapter      MetaInteractionAdapter
      |                          |
      +------------+-------------+
                   |
                   v
              Meta Graph API
```

Inbound:

```text
Meta Webhook
    |
    v
Verification
    |
    v
PostgreSQL + Outbox
    |
    v
Webhook Processing
    |
    v
External Interaction
    |
    v
Policy / Moderation
    |
    v
Interaction Response
    |
    v
MetaInteractionAdapter
```

Outbound publication:

```text
Publication
    |
    v
Scheduler
    |
    v
Transactional Outbox
    |
    v
BullMQ
    |
    v
ContentPublishWorker
    |
    v
MetaPublisherAdapter
    |
    v
Meta Graph API
    |
    v
Reconciliation
```

The authoritative state remains PostgreSQL. Redis/BullMQ remains execution infrastructure. The transactional outbox remains the durable bridge between state and asynchronous work. Provider-specific behavior remains isolated behind Meta adapters and provider services. External uncertainty remains reconciled.

This specification defines the target behavior of that established architecture. It does not function as a remediation plan or development backlog.

---

# 52. Decision Record

**Decision:** Adopt this document as the current consolidated Meta technical specification and system behavior contract.

**Version:** 1.4

**Historical predecessor:** Meta integration specification v1.0 aligned with Phase 18a.

**Current persistence baseline:** DB v1.2 / 44 tables / 14 migrations.

**Document role:** Normative architecture, runtime behavior, persistence boundary, failure handling, reconciliation and operational contract.

**Excluded from this document:** Implementation work order, remediation backlog, audit findings and project-management status tracking.

---

# Appendix A — Current Meta Component Map

```text
apps/api
  |
  +-- Meta webhook ingress
  |
  +-- signature verification
  |
  +-- envelope validation
  |
  +-- destination resolution
  |
  +-- PostgreSQL transaction
        |
        +-- webhook_events
        +-- outbox_jobs
  |
  v
OutboxDispatcher
  |
  v
BullMQ
  |
  +-----------------------------+
  |                             |
  v                             v
webhook.process             content.publish
  |                             |
  v                             v
WebhookProcessWorker       ContentPublishWorker
  |                             |
  v                             v
ExternalInteraction        MetaPublisherAdapter
  |                             |
  v                             v
InteractionResponse        Meta Graph API
  |
  v
WebhookRespondWorker
  |
  v
MetaInteractionAdapter
  |
  v
Meta Graph API
```

---

# Appendix B — Durable Meta Persistence

The Meta integration uses the DB v1.2 persistence baseline. Relevant entities include:

```text
destinations
    |
    +-- webhook_subscriptions
    |       |
    |       +-- webhook_subscription_health
    |
    +-- webhook_events
    |       |
    |       +-- webhook_deliveries
    |       |
    |       +-- external_interactions
    |
    +-- provider_credentials
    |
    +-- interaction_responses
            |
            +-- interaction_response_attempts
            +-- interaction_moderation_actions
            +-- interaction_response_reconciliations

publications
    |
    +-- external_interactions (optional / SET NULL)

outbox_jobs
    |
    +-- no foreign keys
```

The complete physical schema remains governed by `DATABASE_SCHEMA_CONTRACT.md` v1.2 and contains 44 tables.

---

# Appendix C — Queue Map

```text
webhook.process
    → WebhookProcessWorker

webhook.respond
    → WebhookRespondWorker

webhook.respond.reconcile
    → WebhookRespondReconcileWorker

content.publish
    → ContentPublishWorker

publication.reconcile
    → PublicationReconcileWorker

meta.credential.refresh
    → credential lifecycle worker
```

Queue names are execution contracts and must remain consistent with the corresponding outbox `queue_name` values.

---

# Appendix D — Verification Evidence

The established implementation has demonstrated the following integration paths and these paths form regression evidence for the specification.

## Inbound Meta E2E

```text
Meta Page
  ↓
webhook ingress
  ↓
webhook_events
  ↓
webhook.process
  ↓
FeedChangeExtractor
  ↓
external_interactions
```

A real Page comment was materialized as an external interaction.

## Outbound publication E2E

```text
SCHEDULED
  ↓
PublicationScheduler
  ↓
outbox
  ↓
BullMQ
  ↓
ContentPublishWorker
  ↓
MetaPublisherAdapter
  ↓
Meta Graph API
  ↓
PUBLISHED
```

The established Phase 19 E2E demonstrated a successful external publication and persisted the external post identity.

---

# Appendix E — Document Relationship

```text
TECHNICAL_SPECIFICATION.md v0.9.0
            |
            +--------------------------+
            |                          |
            v                          v
LOGICAL_MODEL_SPECIFICATION v1.0   META_INTEGRATION_SPECIFICATION v1.4
            |                          |
            v                          |
DATABASE_SCHEMA_CONTRACT v1.2 <-------+
```

The Meta technical specification defines Meta-specific behavior within the constraints of the platform-wide architecture, logical model and physical persistence contract.

---

**End of `META_INTEGRATION_SPECIFICATION.md`**
