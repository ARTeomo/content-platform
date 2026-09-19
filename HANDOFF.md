# Handoff --- Project State

This document records the project state at a milestone boundary. It is
intended to be read first when resuming work in a new session.

**Snapshot date:** 2026-09-19\
**Last commit:** `641d106` (feat(worker): add publication reconcile
worker)\
**Repository:** https://github.com/ARTeomo/content-platform

---

## Milestone: Phase 19c complete --- publication reconciliation

The outbound Meta publication path now has both the execution and
bounded pull-reconciliation layers wired into `apps/worker`.

Phase 19c adds the `publication.reconcile` service and worker, together
with the Meta publication reconciler and the required database
repositories. The worker is now able to investigate publications that
entered `RECONCILIATION`, match a post on the destination Page feed, and
apply the corresponding durable state transition.

The outbound execution/reconciliation loop is:

```text
publications
  → content.publish
  → OutboxDispatcher
  → BullMQ content.publish
  → ContentPublishWorker
  → ContentPublishService
  → MetaPublisherAdapter
  → Meta Graph API
  → publications.status

When the publication outcome is uncertain:

publications.status = RECONCILIATION
  → publication.reconcile
  → BullMQ publication.reconcile
  → PublicationReconcileWorker
  → PublicationReconcileService
  → MetaPublicationReconciler
  → Meta Graph API feed lookup
  → durable reconciliation result
  → PUBLISHED | RETRY | RECONCILIATION
```

The reconciliation service applies these documented outcomes:

- `PUBLISHED` when a unique matching external post is found.
- `RETRY_ELIGIBLE` when no match is found after the propagation grace
  period.
- `STILL_UNKNOWN` when the result remains inconclusive.
- A publication with no corresponding attempt record is treated as a
  data integrity failure and is moved to `FAILED`.

The publication reconciliation path is deliberately separate from the
interaction-response reconciliation path. Both use the same
architectural principles --- durable state in PostgreSQL, asynchronous
execution through BullMQ, and explicit reconciliation of uncertain
external outcomes --- but operate on different domain state machines.

### Verification state

The current local verification recorded for the Phase 19c state is:

```text
203 passed
0 failed
0 skipped
6 workspace packages
```

The complete 203-test run requires both `TEST_DATABASE_URL` and
`TEST_REDIS_URL` to be exported. The DB/Redis-dependent tests are
therefore not equivalent to the earlier 99 passed / 47 skipped local run
performed before the Phase 19c completion.

The six workspace packages are:

```text
packages/database
packages/authentication
packages/interaction-response
packages/publishers
apps/worker
apps/api
```

The latest GitHub commit `641d106` contains the `publication.reconcile`
worker wiring, the `PublicationReconcileService`, and the corresponding
worker/type exports.

The current state should therefore be interpreted as **Phase 19c
complete / Phase 19d pending**, not as a partially implemented
reconciliation subsystem.

---

## Milestone progression: Phase 19a → 19b → 19c

The outbound publication work has progressed incrementally rather than
as a single architectural jump:

- **Phase 19a — outbound publication execution:** the existing
  `content.publish` path was established as the durable outbound
  execution path:
  `publications` → transactional outbox → BullMQ → `ContentPublishWorker`
  → `ContentPublishService` → `MetaPublisherAdapter` → Meta Graph API.
- **Phase 19b — uncertain-outcome reconciliation foundation:** the
  publication lifecycle was extended with explicit reconciliation
  semantics and durable attempt/reconciliation state so an uncertain
  external outcome is not incorrectly treated as either success or
  failure.
- **Phase 19c — worker/service/reconciler completion:** the
  `publication.reconcile` queue, worker, service, and
  `MetaPublicationReconciler` were wired into `apps/worker`, completing
  the execution/reconciliation layer.

The remaining **Phase 19d** work is orchestration: scheduling due
publications and stale reconciliation work into the transactional
outbox. It is not a redesign of the Phase 19c publication path.

This distinction is important when resuming development: **19c is
complete at the worker/service/reconciler level; 19d adds controlled
scheduling on top of it.**

---

## Milestone: Phase 18b complete --- interaction response lifecycle

The complete two-way Meta integration is closed at the application
level. The platform can receive inbound interactions, decide on an
outbound response through a deterministic policy engine, route it
through a moderation gate, send it through the Graph API, and reconcile
uncertain outcomes through both push and pull paths.

The full inbound → interaction-response loop:

```text
Meta POST (HTTPS, Live mode)
  → apps/api POST /api/v1/webhooks/meta
      1. HMAC-SHA256 signature verify (fail-closed → 401)
      2. Zod envelope validate (fail-closed → 400)
      3. Resolve destination from entry[0].id (Meta Page ID)
      4. Single PostgreSQL transaction:
           INSERT webhook_events (ON CONFLICT DO NOTHING RETURNING id)
           IF inserted:
             INSERT outbox_jobs (queue_name = 'webhook.process')
      5. HTTP 200 OK
  → OutboxDispatcher (FOR UPDATE SKIP LOCKED claim)
  → BullMQ webhook.process queue
  → WebhookProcessWorker
  → WebhookProcessService
      a. materialize external_interactions (monotonic upsert)
      b. push-reconciliation: actor == own Page → mark matching response
         RESPONDED
      c. otherwise: InteractionResponseService.decide(...)
           → AUTO_RESPOND path enqueues outbox job
             (queue_name = 'webhook.respond')
  → OutboxDispatcher
  → BullMQ webhook.respond queue
  → WebhookRespondWorker
  → WebhookRespondService
  → MetaInteractionAdapter
  → Meta Graph API
  → interaction_responses.status =
       RESPONDED | RETRY | FAILED | UNKNOWN
```

The Phase 18b implementation contains:

- `packages/interaction-response` --- pure, deterministic policy
  engine and template renderer.
- `MetaInteractionAdapter` --- Meta Graph API comment response
  adapter.
- `MetaResponseReconciler` --- pull reconciliation for uncertain
  interaction responses.
- `MetaGraphBridge` --- worker-side HTTP bridge for Graph API POST and
  GET.
- `InteractionResponseService`.
- `WebhookRespondService`.
- `WebhookRespondReconcileService`.
- `WebhookRespondWorker`.
- `WebhookRespondReconcileWorker`.
- Four interaction-response repositories.
- Push-reconciliation integrated into `WebhookProcessService`.
- `webhook.respond` and `webhook.respond.reconcile` queues.

---

## Milestone: Phase 18a complete --- real Meta E2E verified

The inbound Meta integration was verified end-to-end against the **real
Meta Graph API** in **Live** mode. A real comment on the
`contentplatform.dev` Page produced a real `external_interactions` row.

Evidence from the real Meta event on 2026-09-18 20:33 UTC:

```text
webhook_events:
  external_object_id = '1287488901121523'
  status             = 'PROCESSED'

external_interactions:
  interaction_type = 'COMMENT'
  external_id      = '122094187437489537_1582353133389249'
  content          = 'This is the very first comment on Content Platform.'

worker:
  [webhook.process] event 87f0c082-... processed: 1 interactions
```

The `feed` field with `item: 'status'` representing the Page's own post
creation is correctly skipped. `FeedChangeExtractor` materializes only
`comment`, `reaction`, and `mention` changes.

```text
[webhook.process] event 35e49212-... processed: 0 interactions   (status)
[webhook.process] event 87f0c082-... processed: 1 interactions   (comment)
```

---

## Meta App configuration (recorded for continuity)

---

Item Value

---

Meta App ID `915404831335846`

Meta App Mode **Live**

Business portfolio ID `1416443380591994`

Business portfolio name `Content Platform`

Page ID (Facebook) `1287488901121523`

Page username `contentplatform.dev`

System User `contentplatform-bot` (`61594178114698`)

Subscribed fields `feed`, `mention`

Verify token `content-platform-verify-2026`

Ngrok URL (recorded) `https://uncanny-reappoint-unaligned.ngrok-free.dev`
------------------------------------------------------------------------------------------

Database records created during the Phase 18a E2E test:

Table ID

---

`destinations.id` `51eb5e79-b6a5-4f51-86bb-23dd81e9167e`
`webhook_subscriptions.id` `2bc850b3-3e93-45d7-98cd-45e07a2daf00`

**Security note:** the Meta App Secret and the ngrok authtoken appeared
in the development chat during setup. Rotate both before any external
collaboration.

- App Secret: Meta App → Settings → Basic → Reset.
- Ngrok token: regenerate from the ngrok dashboard.

The System User token is stored only in the browser session and is not
committed to the repository.

---

## Current state

### Workspace

Six workspace packages:

---

Package Purpose Tests

---

`packages/database` Drizzle schema, migrations, 22
repositories,  
TransactionManager

`packages/authentication` AES-256-GCM, 37
MetaCredentialService, Graph
API client

`packages/interaction-response` Policy engine, template 21
renderer (pure,  
deterministic)

`packages/publishers` MetaInteractionAdapter, 51
MetaPublisherAdapter,  
MetaResponseReconciler,  
MetaPublicationReconciler,  
NoopMetaRateLimiter

`apps/worker` OutboxDispatcher, 68
webhook.process,  
webhook.respond,  
content.publish,  
publication.reconcile  
workers

`apps/api` Fastify webhook ingress 4
(POST + GET)

**Total** **203**
-------------------------------------------------------------------------------------------

The 203-test verification is recorded with `TEST_DATABASE_URL` and
`TEST_REDIS_URL` available. The earlier pre-Phase-19c run was 99 passed,
0 failed, and 47 skipped because the database-backed tests were not
enabled.

### Database schema

- **44 tables** implementing DB v1.2.
- **14 migrations** (`0000` -- `0013`), applied to Neon PostgreSQL.
- `pgcrypto` extension registered in `0000`, never re-declared.
- Partial index
  `publications(external_post_id) WHERE ... IS NOT NULL`.
- Partial unique index `provider_credentials_unique` with `COALESCE`.
- Deferred FK `external_interactions.publication_id` →
  `publications.id`.

### Repositories implemented

There are **15 repository classes** currently exported by
`packages/database/src/repositories/index.ts`.

#### Webhook / outbox / destination

- `OutboxRepository` --- `FOR UPDATE SKIP LOCKED` two-step claim.
- `WebhookSubscriptionsRepository`.
- `WebhookSubscriptionHealthRepository`.
- `WebhookEventsRepository` --- idempotent insert with
  `ON CONFLICT DO NOTHING`.
- `WebhookDeliveriesRepository`.
- `ExternalInteractionsRepository` --- monotonic upsert on
  `occurred_at`.
- `DestinationsRepository`.

#### Publication lifecycle

- `PublicationsRepository` --- includes lookup by external post ID and
  destination.
- `PublicationAttemptsRepository`.
- `PublicationReconciliationsRepository`.

#### Credentials

- `ProviderCredentialsRepository` --- protected by the partial unique
  index.

#### Interaction response lifecycle

- `InteractionResponsesRepository` --- includes `claimForResponding`
  and `findByDestinationAndExternalResponseId`.
- `InteractionResponseAttemptsRepository`.
- `InteractionModerationActionsRepository`.
- `InteractionResponseReconciliationsRepository`.

All repository integration tests with a database dependency run against
Neon PostgreSQL when `TEST_DATABASE_URL` is configured.

### Platform primitives

- `createDatabaseClient` --- database factory with health check and
  graceful shutdown.
- `TransactionManager` --- `run(fn)` transactional API.
- `OutboxRepository.enqueue(tx, job)` --- transactional outbox entry
  point.
- `OutboxDispatcher` --- PostgreSQL → BullMQ bridge with stale
  recovery and cleanup.
- `BullMqJobQueue` --- per-queue BullMQ `Queue` instances keyed by
  logical queue name.
- `BullMqJobConsumer` --- BullMQ `Worker` wrapper, exported as
  `JobConsumer`.
- `redisOptionsFromUrl` --- URL → `RedisOptions`, including TLS
  auto-detection and `family: 4` for Windows + Upstash compatibility.
- `sql` re-exported from `@content-platform/database`, keeping the
  `drizzle-orm` peer-resolution boundary inside the database package.
- `WebhookProcessService` --- parse and materialize webhook events.
- `ChangeExtractorRegistry` --- field-specific `feed` and `mention`
  extractors.
- `InteractionResponseService` --- policy + template + moderation
  gate + transactional outbox enqueue.
- `WebhookRespondService` --- atomic claim, Graph API call, and state
  transitions.
- `WebhookRespondReconcileService` --- pull reconciliation for
  interaction responses.
- `MetaInteractionAdapter` --- Graph API POST with error
  classification.
- `MetaResponseReconciler` --- Graph API GET with response-body
  matching.
- `MetaPublisherAdapter` --- outbound Page publication adapter.
- `MetaPublicationReconciler` --- outbound publication pull
  reconciler.
- `MetaGraphBridge` --- worker-side HTTP bridge for Graph API POST and
  GET.
- `ContentPublishService` --- durable publication execution service.
- `ContentPublishWorker` --- `content.publish` queue consumer.
- `PublicationReconcileService` --- publication pull-reconciliation
  service.
- `PublicationReconcileWorker` --- `publication.reconcile` queue
  consumer.
- `MetaCredentialService` --- credential store, rotation,
  invalidation, validation, and health checks.
- `MetaErrorMapper` --- Graph API error categorization.
- `CredentialEncryptionProvider` --- AES-256-GCM with AAD binding and
  key rotation.

### Webhook inbound pipeline --- COMPLETE

The inbound webhook path is complete:

```text
Meta POST (HTTPS)
  → apps/api POST /api/v1/webhooks/meta
      1. Raw body buffer
      2. HMAC-SHA256 signature verification
      3. Zod envelope validation
      4. Destination resolution from entry[0].id
      5. Single PostgreSQL transaction
           webhook_events
           outbox_jobs(queue_name = 'webhook.process')
      6. HTTP 200 OK
  → OutboxDispatcher
  → BullMQ webhook.process
  → WebhookProcessWorker
  → WebhookProcessService
  → external_interactions
  → InteractionResponseService
```

The `GET /api/v1/webhooks/meta` handshake is also implemented:

1.  `hub.mode` must be `subscribe`; `hub.verify_token` and
    `hub.challenge` are required.
2.  All active META webhook subscriptions are checked.
3.  `verify_token_encrypted` is decrypted using
    `WEBHOOK_TOKEN_ENCRYPTION_KEY`.
4.  AAD is `META:${destination_id}`.
5.  Ciphertext format is `v1:base64(iv ‖ ciphertext ‖ tag)` using
    AES-256-GCM.
6.  On match, `last_verified_at` is updated and `hub.challenge` is
    returned as plain text.
7.  On mismatch, HTTP 403 is returned.

### Outbound publication pipeline --- execution + reconciliation complete;

### scheduling not yet implemented

The execution/reconciliation layer is complete. The missing orchestration
layer is `PublicationScheduler` (Phase 19d), which is responsible only
for discovering due/stale durable state and atomically creating the
corresponding outbox work.

```text
publications
   ↓
[PublicationScheduler — NOT YET IMPLEMENTED]
   ↓
outbox_jobs (queue_name = 'content.publish')
   ↓
OutboxDispatcher
   ↓
BullMQ content.publish
   ↓
ContentPublishWorker
   ↓
ContentPublishService
   ↓
MetaPublisherAdapter
   ↓
Meta Graph API
   ↓
publications.status =
   PUBLISHED | RETRY | FAILED | RECONCILIATION

RECONCILIATION
   ↓
[PublicationScheduler — NOT YET IMPLEMENTED]
   ↓
outbox_jobs (queue_name = 'publication.reconcile')
   ↓
BullMQ publication.reconcile
   ↓
PublicationReconcileWorker
   ↓
PublicationReconcileService
   ↓
MetaPublicationReconciler
   ↓
Meta Graph API feed lookup
   ↓
PUBLISHED | RETRY | RECONCILIATION
```

Every execution and reconciliation worker/service is implemented. The
missing component is the scheduler that moves due or stale rows from the
`publications` table into the corresponding outbox queues.

### Interaction response lifecycle --- COMPLETE

The interaction-response state machine and its worker/reconciliation
path are implemented. `AUTO_RESPOND` decisions enqueue `webhook.respond`
through the transactional outbox. `UNKNOWN` external outcomes are
handled through the dedicated reconciliation path.

### `apps/worker/src/index.ts` --- what it starts

- `OutboxDispatcher`.
- `WebhookProcessWorker` --- `webhook.process`.
- `WebhookRespondWorker` --- `webhook.respond`.
- `WebhookRespondReconcileWorker` --- `webhook.respond.reconcile`.
- `ContentPublishWorker` --- `content.publish`.
- `PublicationReconcileWorker` --- `publication.reconcile`.
- Graceful shutdown in dependency order:
  `publication.reconcile → content.publish →   webhook.respond.reconcile → webhook.respond → webhook.process →   dispatcher → queue → db`.

### `apps/api` --- routes

---

Method Path Purpose

---

GET `/health` Liveness

GET `/ready` Readiness with DB
health check

POST `/api/v1/webhooks/meta` Webhook ingress
(signature +
transaction + outbox)

GET `/api/v1/webhooks/meta` Meta `hub.challenge`
handshake
-------------------------------------------------------------------------

### Cloud services

Service Provider Region URL scheme

---

PostgreSQL 16 Neon eu-central-1 `postgresql://`
Redis 7 (TLS) Upstash eu-central-1 `rediss://`

**No local Docker.** The development machine runs Windows 10 1607 (build 14393) with 4 GB RAM. Docker Desktop requires Windows 10 22H2 (build 19045) and 8 GB RAM. Cloud services are therefore the supported
development path. `docker-compose.yml` is retained as a reference for
future environments.

### Toolchain

- Node.js **22.20.0** (pinned in `.nvmrc`).
- pnpm **12.3.4** (pinned via `packageManager`).
- TypeScript **7.0.2** (pinned in `package.json` and
  `pnpm-workspace.yaml`).
- Drizzle ORM **0.45.2**, Drizzle Kit **0.31.10**.
- BullMQ **5.34.0**, ioredis **5.4.2**.
- Fastify **5.2.0**, Zod **3.24.1**.
- Vitest **5.0.0**.
- ESLint **10.10.0**, Prettier **3.9.6**.

### Documentation

- `README.md`
- `HANDOFF.md` --- this file
- `docs/README.md`
- `docs/adr/` --- Architecture Decision Records
- `docs/architecture/README.md`
- `docs/architecture/system-overview.md`
- `docs/architecture/domain-model.md`
- `docs/architecture/data-model.md`
- `docs/architecture/TECHNICAL_SPECIFICATION.md`
- `docs/architecture/DATABASE_SCHEMA_CONTRACT.md`
- `docs/architecture/LOGICAL_MODEL_SPECIFICATION.md` --- status
  unconfirmed
- `docs/conventions/`
- `docs/operations/README.md`
- `docs/operations/local-development.md`
- `docs/operations/meta-app-setup.md`

---

## Pending items

### 1. PublicationScheduler --- Phase 19d

Two scheduler scans are required to complete the outbound execution
loop:

1.  Find `SCHEDULED` publications with `scheduled_at <= now()` and
    enqueue `content.publish` through `outbox_jobs`.
2.  Find stale `RECONCILIATION` publications whose `updated_at` is older
    than the reconciliation threshold and enqueue
    `publication.reconcile` through `outbox_jobs`.

Both scans must execute their durable state transition and outbox
enqueue inside one PostgreSQL transaction with an optimistic status
guard so that multiple scheduler executions cannot enqueue the same
publication concurrently.

The intended scheduling mechanism is a `system.publication.schedule` job
with a cron-like cadence or an equivalent controlled polling mechanism.

### 2. Real outbound E2E

The outbound `content.publish` pipeline has not yet been verified
against the real Meta Graph API. After Phase 19d provides scheduling,
run a real publication against the `contentplatform.dev` Page and
verify:

- publication execution through `MetaPublisherAdapter`;
- durable `PUBLISHED` transition;
- push reconciliation of the resulting Page feed webhook;
- pull reconciliation for an uncertain publication outcome.

### 3. Interaction response configuration

`apps/worker/src/index.ts` currently uses:

- `DEFAULT_INTERACTION_RESPONSE_CONFIG` --- empty rule set,
  fail-closed;
- `DEFAULT_TEMPLATES` --- empty map.

Real configuration must eventually be loaded from `system_config` under:

- `interaction_response_rules`;
- `interaction_response_templates`.

### 4. Temporary Meta credential shortcut

The worker currently obtains the Meta Page access token from
`META_PAGE_ACCESS_TOKEN`. This bypasses the DB-backed encrypted
`MetaCredentialService` path for worker Graph API calls.

The encrypted credential lifecycle exists, but the worker-side
publishing, interaction-response, and publication-reconciliation wiring
still use the environment token shortcut.

### 5. `destinations.trust_level`

The current database schema does not contain a `trust_level` column. The
interaction policy path therefore uses its configured/default trust
level as an application value. A dedicated database column should only
be introduced when the reputation subsystem defines the authoritative
source.

### 6. `LOGICAL_MODEL_SPECIFICATION.md`

The documentation references
`docs/architecture/LOGICAL_MODEL_SPECIFICATION.md`. Its presence and
version/status should be explicitly verified before treating the logical
model as confirmed.

### 7. Meta App Secret and ngrok authtoken rotation

Both secrets appeared in the development chat during the Meta E2E setup.
They must be rotated before external collaboration or broader credential
distribution.

### 8. Ngrok URL is ephemeral

The recorded free ngrok URL changes when the tunnel is restarted. The
Meta Webhook callback configuration therefore has to be updated after a
restart. For stable long-running development, use a fixed public HTTPS
endpoint or a static ngrok domain.

---

## Next steps

### Phase 19d --- PublicationScheduler

Phase 19c is complete. Phase 19d adds only the missing scheduling and
orchestration layer on top of the already implemented publication
execution/reconciliation services.

Implement:

- `apps/worker/src/publication/publication-scheduler-service.ts`
- `apps/worker/src/publication/publication-scheduler-worker.ts`

Required behavior:

- scan `publications` for due `SCHEDULED` rows;
- scan for stale `RECONCILIATION` rows;
- enqueue `content.publish` and `publication.reconcile` through
  `outbox_jobs`;
- perform the row state transition and outbox insertion in one
  transaction;
- use optimistic guards for idempotent scheduling;
- register the scheduler worker in `apps/worker/src/index.ts`;
- provide the `system.publication.schedule` scheduling mechanism.

### Phase 20 --- Real E2E verification and production readiness

After scheduling exists:

1.  Run a real publication through the complete outbound chain.
2.  Verify the publication state transition against the real Meta Graph
    API.
3.  Verify push reconciliation through the existing Meta feed webhook.
4.  Verify pull reconciliation for uncertain publication outcomes.
5.  Audit and update the operational runbooks in `docs/operations/`.

---

## Architectural invariants (must not be violated)

1.  PostgreSQL is the authoritative system of record.
2.  Redis/BullMQ is the asynchronous execution layer.
3.  Every durable domain transition that produces a side effect enqueues
    through `outbox_jobs` in the same PostgreSQL transaction.
4.  No direct BullMQ enqueue is permitted on a durable-write hot path.
5.  The webhook ingress performs exactly one database transaction per
    HTTP request and no Redis call on the hot path.
6.  Provider credentials are encrypted at rest with application-managed
    keys. No plaintext secret is persisted in any ordinary application
    table.
7.  `outbox_jobs` has no foreign keys.
8.  Reconciliation is mandatory for every state machine that has an
    external side effect.
9.  The system fails closed when mandatory validation cannot be
    completed.
10. Publication reconciliation must remain separate from interaction
    response reconciliation at the domain/service boundary.
11. The publisher adapter is not the application foundation;
    provider-specific code remains behind narrow publisher/interaction
    interfaces.

---

## Known patterns and traps

These are lessons learned during Phases 14--19c. They are captured here
so the next session does not re-encounter them.

### `GraphClient` / `GraphPostClient` compatibility alias

The authentication/Graph client surface uses `GraphClient` as the
canonical abstraction. Where older worker-side terminology refers to
`GraphPostClient`, it is a compatibility alias, not a second Graph API
interface:

```typescript
export type GraphPostClient = GraphClient;
```

Do not introduce a parallel interface merely to preserve the older name.
The canonical implementation and behavior remain those of `GraphClient`.

### Stale workspace `dist/*.d.ts` can hide source changes

The worker consumes workspace packages through their package exports,
which may resolve to generated `dist` declarations. Therefore a source
file can contain a newly exported type or method while the worker still
sees an older declaration file.

When TypeScript reports that an existing workspace export or method is
missing, first rebuild the producing workspace packages:

```text
pnpm build
```

Only after the generated declarations are current should the error be
treated as a real source-level or architectural defect.

This is especially relevant to repository barrels and cross-package
worker imports.

### Direct `drizzle-orm` imports in workers change the dependency boundary

The current worker boundary intentionally obtains Drizzle helpers such
as `sql` through `@content-platform/database`. This keeps
`drizzle-orm` ownership at the database package boundary.

If worker source code directly imports from `drizzle-orm`, that is no
longer an incidental transitive dependency: `drizzle-orm` becomes a
direct worker dependency and the workspace package manifest must declare
it explicitly.

Prefer the existing database-package export when the worker only needs
the already-established database abstraction. Do not add a duplicate
worker dependency merely to compensate for a stale declaration or barrel
export.

### `RETURNING *` in raw SQL returns snake_case

Every raw SQL query with `RETURNING *` returns snake_case column names
that do not match the Drizzle `$inferSelect` type.

Two correct patterns:

1.  `RETURNING id` in raw SQL, then a Drizzle `SELECT` for the full row.
2.  Explicit `RETURNING id AS "id", col AS "camelCase"` aliases.

Never cast a `RETURNING *` result directly to a camelCase type.

### `ioredis` URL constructor overload

`ioredis` 5.x does not accept `(url: string, options)`. URLs must be
parsed into `RedisOptions` through `redisOptionsFromUrl`.

The parser:

- enables TLS for Upstash hosts and `rediss://`;
- forces `family: 4` for Windows dual-stack compatibility;
- sets `servername` for SNI.

### pnpm peer resolution --- keep the current Drizzle boundary

`drizzle-orm` has a peer dependency on `postgres`. The current worker
does not depend on `drizzle-orm` directly; the `sql` template tag is
re-exported from `@content-platform/database`, keeping the database
abstraction boundary in one place.

Do not add a direct worker dependency just because an old generated
declaration is missing an export. Rebuild first. A direct
`drizzle-orm` import is appropriate only when the worker genuinely
needs to consume Drizzle directly; in that case it must be declared as
a direct dependency of the worker package.

### `exactOptionalPropertyTypes` and conditional spread

With `exactOptionalPropertyTypes: true`, `field: undefined` is not
assignable to `field?: string`.

Use:

```typescript
...(field !== undefined && { field }),
```

This pattern is used throughout the repositories and API webhook
ingress.

### Fastify raw body for HMAC verification

Fastify parses `application/json` into an object by default, losing the
raw bytes needed for HMAC-SHA256 verification.

Use a custom content-type parser with `parseAs: 'buffer'` and attach
`request.rawBody` through a Fastify module augmentation. Never
reconstruct the signed bytes from the parsed JSON object.

### pnpm `-r` runs packages in parallel --- use `--workspace-concurrency=1`

Integration tests share a PostgreSQL database and Redis instance. Even
with `fileParallelism: false` inside each package, `pnpm -r` can run
workspace packages concurrently.

The root test script must use:

```text
"test": "pnpm -r --workspace-concurrency=1 --if-present run test"
```

### `__dirname` in Vitest configs

Use `import.meta.dirname` instead of `__dirname` in Vitest
configuration. The native config loader path is not compatible with the
old pattern.

### `source .env` is unreliable in Git Bash

The Neon and Upstash URLs can contain `&`, which Git Bash interprets as
a background-job separator.

Use a controlled export, for example:

```bash
export TEST_DATABASE_URL="$(grep '^TEST_DATABASE_URL=' .env | cut -d= -f2-)"
```

and export `TEST_REDIS_URL` similarly.

### Neon direct vs pooled connections

`drizzle-kit migrate` uses prepared statements and therefore must use
the Neon **Direct connection** URL rather than the PgBouncer
transaction-pool URL.

Runtime application connections may use the pooled URL where
appropriate.

### PostgreSQL identifier truncation --- NOTICE 42622

Long PostgreSQL foreign-key identifiers can be truncated to the
63-character identifier limit. This is informational when the generated
migration is otherwise correct.

### Publication reconciliation is bounded pull-based fallback

The publication reconciliation path is not the primary success path.

The normal success path is:

```text
Meta Graph API response
  → publication attempt result
  → publications.status = PUBLISHED
```

When the external outcome is uncertain, the publication enters
`RECONCILIATION` and the bounded pull reconciler investigates the
destination Page feed. Independently, an inbound Meta feed webhook can
provide push confirmation of the platform's own outbound publication.

Therefore:

- **primary confirmation:** the outbound publication attempt;
- **push confirmation:** inbound Meta feed webhook;
- **pull reconciliation:** bounded fallback for uncertain outcomes.

`MetaPublicationReconciler` is not intended to replace the publication
attempt or become the normal success path. A unique matching post yields
`PUBLISHED`; no match after the propagation grace yields a retry-eligible
result; an inconclusive result remains in reconciliation/unknown state.

### Push reconciliation must not enter interaction policy

When `WebhookProcessService` receives a feed interaction whose actor is
the destination Page itself, it represents the platform's own outbound
action. That event must be handled as reconciliation and must not
continue into the normal interaction policy decision path.

---

## Source-of-truth hierarchy

```text
1. Domain and architecture contracts
2. DB v1 Logical Model Specification
3. DATABASE_SCHEMA_CONTRACT.md
4. Drizzle schema implementation
5. Generated PostgreSQL migrations
```

Any change to the physical schema requires revising the higher-level
contract first.
