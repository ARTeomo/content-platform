# Handoff — Project State

This document records the project state at a milestone boundary. It is
intended to be read first when resuming work in a new session.

**Snapshot date:** 2026-09-19
**Last commit:** `37bfa40` (chore(scripts): add phase-19e operational tooling)
**Repository:** https://github.com/ARTeomo/content-platform

---

## Milestone: Phase 19e complete — real outbound E2E verified

The outbound publication pipeline is verified end-to-end against the
real Meta Graph API. A real post was published to the
`contentplatform.dev` Page from a real `SCHEDULED` publication row.

Evidence from the successful run on 2026-09-19 22:48:01 CEST:

```text
publications:
  id               = 19c3b29c-e60a-4c3d-a5ed-edf11afa54c9
  status           = PUBLISHED
  external_post_id = 1287488901121523_122094921165489537
  published_at     = 2026-09-19 22:48:01 CEST

publication_attempts:
  attempt #3 status = SUCCESS
  external_post_id  = 1287488901121523_122094921165489537

worker log:
  [publication.schedule] scheduled=1 reconciled=0
  [content.publish] publication 19c3b29c-... → PUBLISHED (1287488901121523_122094921165489537)
  [content.publish] job content.publish:19c3b29c-... → PUBLISHED
```

The post is visible on the Page:
`https://www.facebook.com/contentplatform.dev`

### The verified chain

```text
publications.status = SCHEDULED, scheduled_at <= now()
        ↓
PublicationSchedulerService.scanScheduled()
  FOR UPDATE SKIP LOCKED, SCHEDULED → RESERVED
        ↓
outbox_jobs (queue_name = 'content.publish')
        ↓
OutboxDispatcher
  FOR UPDATE SKIP LOCKED claim, PENDING → DISPATCHING → DISPATCHED
        ↓
BullMQ content.publish queue
        ↓
ContentPublishWorker
        ↓
ContentPublishService.publish()
  atomic claim: RESERVED → IN_PROGRESS
        ↓
MetaPublisherAdapter.postToPage()
        ↓
Meta Graph API
        POST /{page-id}/feed
        ↓
publications.status = PUBLISHED
publication_attempts.status = SUCCESS
```

Every state transition is durable. Every external side effect is
recorded. The pipeline is idempotent across restarts.

### Errors encountered and fixed during Phase 19e

Three distinct defects were exposed by the real E2E test. Each is now
fixed and committed:

1. **`RESERVED` state was not accepted by the claim guard.**
   The `ContentPublishService.publish()` guard only allowed
   `SCHEDULED` and `RETRY`. The 19d scheduler transitions
   `SCHEDULED → RESERVED` before enqueuing, so the worker saw
   `RESERVED` and returned `SKIPPED`. Fixed by adding `RESERVED` to
   the eligible set. Commit `94189c5`.

2. **The claim was not atomic.**
   The old code called `markReserved()` and `markInProgress()` as two
   separate statements with no status guard. A concurrent worker
   (BullMQ retry, `system.rebuild` re-enqueue) could pass the guard
   simultaneously and produce a duplicate external post. Fixed by
   introducing `PublicationsRepository.claimForPublishing(tx, id)`,
   a single `UPDATE ... WHERE id = ? AND status IN ('SCHEDULED',
'RESERVED', 'RETRY') RETURNING id`. Exactly one claimer wins.
   Commit `94189c5`.

3. **BullMQ `jobId` dedup blocked recovered jobs.**
   `BullMqJobQueue` used `removeOnComplete: 1000`, which retained up
   to 1000 completed jobs indefinitely. Because BullMQ deduplicates
   by `jobId` across **all** job states, a recovered outbox row with
   the same deterministic `jobId` was silently dropped by the
   `queue.add()` call. The outbox row was marked `DISPATCHED` (the
   call did not throw), but no BullMQ job was created. Fixed by
   switching to `removeOnComplete: true`. Durable history of every
   external side effect already lives in `publication_attempts`,
   `webhook_deliveries`, and `interaction_response_attempts`.
   Commit `3375993`.

The Meta-side error `(#200) ... requires both pages_read_engagement
and pages_manage_posts as an admin with sufficient administrative
permission` was a **credential** issue, not a code issue: the `.env`
held a System User (User) token instead of a Page Access Token. The
fix is documented below under "Meta credential model".

### New files

- `packages/database/scripts/refresh-page-token.mjs` — derives a Page
  Access Token from a System User token and rewrites the `.env`
  `META_PAGE_ACCESS_TOKEN` line.
- `packages/database/scripts/diagnose-publication.mjs` — prints the
  three-table state of a single publication (`publications`,
  `outbox_jobs`, `publication_attempts`).
- `apps/worker/scripts/inspect-bullmq.mjs` — inspects (and optionally
  removes) BullMQ job state for a given queue.

### Meta credential model

The Meta token surface is a two-step derivation, not a single
generation:

```text
Meta Business Suite: "Kód létrehozása"
        ↓
System User Access Token (User token)
   - default token type in the Business Suite UI
   - NOT sufficient for POST /{page-id}/feed
   - lives temporarily in .env as META_PAGE_ACCESS_TOKEN

        ↓
GET /me/accounts?fields=access_token
        ↓
Page Access Token
   - the token the Graph API requires for Page posting
   - lives in .env as META_PAGE_ACCESS_TOKEN after running
     refresh-page-token.mjs
   - verification: GET /me must return the Page ID
     (1287488901121523), not the System User ID
```

The Business Suite UI does **not** provide a direct "generate Page
Access Token" option. This is intentional on Meta's side and not a
platform defect.

---

## Milestone: Phase 19d complete — publication scheduler

The publication execution/reconciliation loop has its orchestration
layer. `PublicationSchedulerService` discovers due/stale durable state
and atomically creates the corresponding outbox work.

The scheduler contract:

```text
Scan 1 — due SCHEDULED publications
  Claim:   SCHEDULED → RESERVED via FOR UPDATE SKIP LOCKED
  Enqueue: content.publish:{publicationId}

Scan 2 — stale RECONCILIATION publications
  Touch:   updated_at = now() (status unchanged)
  Enqueue: publication.reconcile:{publicationId}:{epoch_ms}
```

Both scans perform the state change and the outbox enqueue in a single
PostgreSQL transaction. A concurrent scheduler instance cannot claim
the same row (`FOR UPDATE SKIP LOCKED`), and the outbox `job_id`
uniqueness protects against accidental double enqueue from a single
scan.

The scheduler is a polling worker (`setTimeout` chain, no
`setInterval`) so a slow scan cannot overlap with the next tick. The
polling cadence is `PUBLICATION_SCHEDULE_INTERVAL_MS` (default 30000),
the batch size is `PUBLICATION_SCHEDULE_BATCH_SIZE` (default 50), and
the reconciliation staleness threshold is
`PUBLICATION_RECONCILE_STALE_THRESHOLD_SECONDS` (default 300).

### New files

- `apps/worker/src/publication/publication-scheduler-service.ts`
- `apps/worker/src/publication/publication-scheduler-worker.ts`
- `apps/worker/src/publication/publication-scheduler-service.test.ts`

### `PublicationsRepository` additions

- `claimDueScheduled(tx, limit)` — atomic `SCHEDULED → RESERVED`
  claim via raw SQL CTE + `FOR UPDATE SKIP LOCKED`, returns the
  claimed IDs.
- `touchStaleReconciliation(tx, thresholdSeconds, limit)` — atomic
  `updated_at = now()` bump on stale `RECONCILIATION` rows via the
  same pattern, returns the touched IDs.
- `claimForPublishing(tx, id)` — atomic pre-execution claim
  (`SCHEDULED | RESERVED | RETRY → IN_PROGRESS`), returns `true` iff
  exactly one row was updated. See Phase 19e, defect #2.

### Verification state

The Phase 19d state recorded 208 passing tests across the six
packages. The Phase 19e additions did not change the test count
(`removeOnComplete: true` is a config change; the queue fix is not
test-covered in this session).

---

## Milestone: Phase 19c complete — publication reconciliation

The outbound Meta publication path now has both the execution and
bounded pull-reconciliation layers wired into `apps/worker`.

Phase 19c adds the `publication.reconcile` service and worker,
together with the Meta publication reconciler and the required
database repositories. The worker is able to investigate publications
that entered `RECONCILIATION`, match a post on the destination Page
feed, and apply the corresponding durable state transition.

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
architectural principles — durable state in PostgreSQL, asynchronous
execution through BullMQ, and explicit reconciliation of uncertain
external outcomes — but operate on different domain state machines.

---

## Milestone progression: Phase 19a → 19b → 19c → 19d → 19e

The outbound publication work has progressed incrementally rather
than as a single architectural jump:

- **Phase 19a — outbound publication execution:** the
  `content.publish` path was established as the durable outbound
  execution path:
  `publications` → transactional outbox → BullMQ →
  `ContentPublishWorker` → `ContentPublishService` →
  `MetaPublisherAdapter` → Meta Graph API.
- **Phase 19b — uncertain-outcome reconciliation foundation:** the
  publication lifecycle was extended with explicit reconciliation
  semantics and durable attempt/reconciliation state so an uncertain
  external outcome is not incorrectly treated as either success or
  failure.
- **Phase 19c — worker/service/reconciler completion:** the
  `publication.reconcile` queue, worker, service, and
  `MetaPublicationReconciler` were wired into `apps/worker`,
  completing the execution/reconciliation layer.
- **Phase 19d — orchestration:** the `PublicationSchedulerService`
  and `PublicationSchedulerWorker` discover due `SCHEDULED`
  publications and stale `RECONCILIATION` publications, perform the
  durable state transition, and enqueue the corresponding outbox job
  in a single transaction.
- **Phase 19e — real outbound E2E verified:** the entire pipeline was
  exercised against the real Meta Graph API. Three defects were
  exposed and fixed (see the Phase 19e section above). A real post
  was published to the `contentplatform.dev` Page from a real
  `SCHEDULED` publication row.

**Phase 19 is now complete.** The next major milestone is v1.3
(`webhook_endpoints` and multi-page Meta support), which is outside
the current baseline Phase 19 scope.

---

## Milestone: Phase 18b complete — interaction response lifecycle

The complete two-way Meta integration is closed at the application
level. The platform can receive inbound interactions, decide on an
outbound response through a deterministic policy engine, route it
through a moderation gate, send it through the Graph API, and
reconcile uncertain outcomes through both push and pull paths.

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

- `packages/interaction-response` — pure, deterministic policy
  engine and template renderer.
- `MetaInteractionAdapter` — Meta Graph API comment response
  adapter.
- `MetaResponseReconciler` — pull reconciliation for uncertain
  interaction responses.
- `MetaGraphBridge` — worker-side HTTP bridge for Graph API POST and
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

## Milestone: Phase 18a complete — real Meta E2E verified

The inbound Meta integration was verified end-to-end against the real
Meta Graph API in Live mode. A real comment on the
`contentplatform.dev` Page produced a real `external_interactions`
row.

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

The `feed` field with `item: 'status'` representing the Page's own
post creation is correctly skipped. `FeedChangeExtractor`
materializes only `comment`, `reaction`, and `mention` changes.

```text
[webhook.process] event 35e49212-... processed: 0 interactions   (status)
[webhook.process] event 87f0c082-... processed: 1 interactions   (comment)
```

---

## Meta App configuration (recorded for continuity)

| Item                    | Value                                                |
| ----------------------- | ---------------------------------------------------- |
| Meta App ID             | `915404831335846`                                    |
| Meta App Mode           | **Live**                                             |
| Business portfolio ID   | `1416443380591994`                                   |
| Business portfolio name | `Content Platform`                                   |
| Page ID (Facebook)      | `1287488901121523`                                   |
| Page username           | `contentplatform.dev`                                |
| System User             | `contentplatform-bot` (`61594178114698`)             |
| Subscribed fields       | `feed`, `mention`                                    |
| Verify token            | `content-platform-verify-2026`                       |
| Ngrok URL (recorded)    | `https://uncanny-reappoint-unaligned.ngrok-free.dev` |

Database records created during the Phase 18a E2E test:

| Table                      | ID                                     |
| -------------------------- | -------------------------------------- |
| `destinations.id`          | `51eb5e79-b6a5-4f51-86bb-23dd81e9167e` |
| `webhook_subscriptions.id` | `2bc850b3-3e93-45d7-98cd-45e07a2daf00` |

**Security note:** the Meta App Secret, the ngrok authtoken, and
multiple Meta access tokens have appeared in the development chat
across Phase 18a and Phase 19e. Rotate all of them before any external
collaboration.

- App Secret: Meta App → Settings → Basic → Reset.
- Ngrok token: regenerate from the ngrok dashboard.
- System User token: Meta Business Suite → System Users →
  contentplatform-bot → `Kódok visszavonása`, then generate a new one.
- Page Access Token: derived from the new System User token via
  `refresh-page-token.mjs`.

The System User token is stored only in the browser session and is
not committed to the repository.

---

## Current state

### Workspace

Six workspace packages:

| Package                         | Purpose                                                                                                                   | Tests   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------- |
| `packages/database`             | Drizzle schema, migrations, repositories, TransactionManager                                                              | 22      |
| `packages/authentication`       | AES-256-GCM, MetaCredentialService, Graph API client                                                                      | 37      |
| `packages/interaction-response` | Policy engine, template renderer (pure, deterministic)                                                                    | 21      |
| `packages/publishers`           | MetaInteractionAdapter, MetaPublisherAdapter, MetaResponseReconciler, MetaPublicationReconciler, NoopMetaRateLimiter      | 51      |
| `apps/worker`                   | OutboxDispatcher, publication scheduler, webhook.process, webhook.respond, content.publish, publication.reconcile workers | 73      |
| `apps/api`                      | Fastify webhook ingress (POST + GET)                                                                                      | 4       |
| **Total**                       |                                                                                                                           | **208** |

The 208-test verification is recorded with `TEST_DATABASE_URL` and
`TEST_REDIS_URL` available. Without those, the DB- and Redis-backed
tests skip.

### Database schema

- **44 tables** implementing DB v1.2.
- **14 migrations** (`0000` – `0013`), applied to Neon PostgreSQL.
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

- `OutboxRepository` — `FOR UPDATE SKIP LOCKED` two-step claim.
- `WebhookSubscriptionsRepository`.
- `WebhookSubscriptionHealthRepository`.
- `WebhookEventsRepository` — idempotent insert with
  `ON CONFLICT DO NOTHING`.
- `WebhookDeliveriesRepository`.
- `ExternalInteractionsRepository` — monotonic upsert on
  `occurred_at`.
- `DestinationsRepository`.

#### Publication lifecycle

- `PublicationsRepository` — includes lookup by external post ID and
  destination; scheduler claim methods `claimDueScheduled` and
  `touchStaleReconciliation`; atomic `claimForPublishing(tx, id)`.
- `PublicationAttemptsRepository`.
- `PublicationReconciliationsRepository`.

#### Credentials

- `ProviderCredentialsRepository` — protected by the partial unique
  index.

#### Interaction response lifecycle

- `InteractionResponsesRepository` — includes `claimForResponding`
  and `findByDestinationAndExternalResponseId`.
- `InteractionResponseAttemptsRepository`.
- `InteractionModerationActionsRepository`.
- `InteractionResponseReconciliationsRepository`.

All repository integration tests with a database dependency run
against Neon PostgreSQL when `TEST_DATABASE_URL` is configured.

### Platform primitives

- `createDatabaseClient` — database factory with health check and
  graceful shutdown.
- `TransactionManager` — `run(fn)` transactional API.
- `OutboxRepository.enqueue(tx, job)` — transactional outbox entry
  point.
- `OutboxDispatcher` — PostgreSQL → BullMQ bridge with stale
  recovery and cleanup.
- `BullMqJobQueue` — per-queue BullMQ `Queue` instances keyed by
  logical queue name. `removeOnComplete: true` (see the queue
  lifecycle note below).
- `BullMqJobConsumer` — BullMQ `Worker` wrapper, exported as
  `JobConsumer`.
- `redisOptionsFromUrl` — URL → `RedisOptions`, including TLS
  auto-detection and `family: 4` for Windows + Upstash compatibility.
- `sql` re-exported from `@content-platform/database`, keeping the
  `drizzle-orm` peer-resolution boundary inside the database package.
- `WebhookProcessService` — parse and materialize webhook events.
- `ChangeExtractorRegistry` — field-specific `feed` and `mention`
  extractors.
- `InteractionResponseService` — policy + template + moderation
  gate + transactional outbox enqueue.
- `WebhookRespondService` — atomic claim, Graph API call, and state
  transitions.
- `WebhookRespondReconcileService` — pull reconciliation for
  interaction responses.
- `MetaInteractionAdapter` — Graph API POST with error
  classification.
- `MetaResponseReconciler` — Graph API GET with response-body
  matching.
- `MetaPublisherAdapter` — outbound Page publication adapter.
- `MetaPublicationReconciler` — outbound publication pull
  reconciler.
- `MetaGraphBridge` — worker-side HTTP bridge for Graph API POST and
  GET.
- `ContentPublishService` — durable publication execution service.
- `ContentPublishWorker` — `content.publish` queue consumer.
- `PublicationReconcileService` — publication pull-reconciliation
  service.
- `PublicationReconcileWorker` — `publication.reconcile` queue
  consumer.
- `PublicationSchedulerService` — due/stale publication orchestration;
  atomic claim + outbox enqueue per scan.
- `PublicationSchedulerWorker` — polling wrapper around the scheduler
  service.
- `MetaCredentialService` — credential store, rotation,
  invalidation, validation, and health checks.
- `MetaErrorMapper` — Graph API error categorization.
- `CredentialEncryptionProvider` — AES-256-GCM with AAD binding and
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

1. `hub.mode` must be `subscribe`; `hub.verify_token` and
   `hub.challenge` are required.
2. All active META webhook subscriptions are checked.
3. `verify_token_encrypted` is decrypted using
   `WEBHOOK_TOKEN_ENCRYPTION_KEY`.
4. AAD is `META:${destination_id}`.
5. Ciphertext format is `v1:base64(iv ‖ ciphertext ‖ tag)` using
   AES-256-GCM.
6. On match, `last_verified_at` is updated and `hub.challenge` is
   returned as plain text.
7. On mismatch, HTTP 403 is returned.

### Outbound publication pipeline --- COMPLETE, VERIFIED

The execution, reconciliation, and scheduling layers are complete and
verified against the real Meta Graph API (see Phase 19e above).

```text
publications
   ↓
PublicationSchedulerService (polling, every
PUBLICATION_SCHEDULE_INTERVAL_MS)
   ↓
outbox_jobs (queue_name = 'content.publish')
   ↓
OutboxDispatcher
   ↓
BullMQ content.publish
   ↓
ContentPublishWorker
   ↓
ContentPublishService (atomic claim → IN_PROGRESS)
   ↓
MetaPublisherAdapter
   ↓
Meta Graph API
   ↓
publications.status =
   PUBLISHED | RETRY | FAILED | RECONCILIATION

RECONCILIATION
   ↓
PublicationSchedulerService (polling, stale
RECONCILIATION rows only)
   ↓
outbox_jobs (queue_name = 'publication.reconcile')
   ↓
OutboxDispatcher
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

Every execution, reconciliation, and scheduling component is
implemented and wired into `apps/worker`.

### Interaction response lifecycle --- COMPLETE

The interaction-response state machine and its worker/reconciliation
path are implemented. `AUTO_RESPOND` decisions enqueue
`webhook.respond` through the transactional outbox. `UNKNOWN`
external outcomes are handled through the dedicated reconciliation
path.

### `apps/worker/src/index.ts` --- what it starts

- `OutboxDispatcher`.
- `PublicationSchedulerWorker` — periodic polling of `SCHEDULED` and
  `RECONCILIATION` publications.
- `WebhookProcessWorker` — `webhook.process`.
- `WebhookRespondWorker` — `webhook.respond`.
- `WebhookRespondReconcileWorker` — `webhook.respond.reconcile`.
- `ContentPublishWorker` — `content.publish`.
- `PublicationReconcileWorker` — `publication.reconcile`.
- Graceful shutdown in dependency order:
  `publicationSchedulerWorker.stop() → publication.reconcile →
content.publish → webhook.respond.reconcile → webhook.respond →
webhook.process → dispatcher → queue → db`.

### `apps/api` --- routes

| Method | Path                    | Purpose                                            |
| ------ | ----------------------- | -------------------------------------------------- |
| GET    | `/health`               | Liveness                                           |
| GET    | `/ready`                | Readiness with DB health check                     |
| POST   | `/api/v1/webhooks/meta` | Webhook ingress (signature + transaction + outbox) |
| GET    | `/api/v1/webhooks/meta` | Meta `hub.challenge` handshake                     |

### Cloud services

| Service       | Provider | Region       | URL scheme      |
| ------------- | -------- | ------------ | --------------- |
| PostgreSQL 16 | Neon     | eu-central-1 | `postgresql://` |
| Redis 7 (TLS) | Upstash  | eu-central-1 | `rediss://`     |

**No local Docker.** The development machine runs Windows 10 1607
(build 14393) with 4 GB RAM. Docker Desktop requires Windows 10 22H2
(build 19045) and 8 GB RAM. Cloud services are therefore the supported
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
- `HANDOFF.md` — this file
- `docs/README.md`
- `docs/adr/` — Architecture Decision Records
- `docs/architecture/README.md`
- `docs/architecture/system-overview.md`
- `docs/architecture/domain-model.md`
- `docs/architecture/data-model.md`
- `docs/architecture/TECHNICAL_SPECIFICATION.md`
- `docs/architecture/DATABASE_SCHEMA_CONTRACT.md`
- `docs/architecture/LOGICAL_MODEL_SPECIFICATION.md` — status
  unconfirmed
- `docs/conventions/`
- `docs/operations/README.md`
- `docs/operations/local-development.md`
- `docs/operations/meta-app-setup.md`

---

## Pending items

### 1. Interaction response configuration

`apps/worker/src/index.ts` currently uses:

- `DEFAULT_INTERACTION_RESPONSE_CONFIG` — empty rule set,
  fail-closed;
- `DEFAULT_TEMPLATES` — empty map.

Real configuration must eventually be loaded from `system_config`
under:

- `interaction_response_rules`;
- `interaction_response_templates`.

### 2. Temporary Meta credential shortcut

The worker currently obtains the Meta Page access token from
`META_PAGE_ACCESS_TOKEN`. This bypasses the DB-backed encrypted
`MetaCredentialService` path for worker Graph API calls.

The encrypted credential lifecycle exists, but the worker-side
publishing, interaction-response, and publication-reconciliation
wiring still use the environment token shortcut.

### 3. `destinations.trust_level`

The current database schema does not contain a `trust_level` column.
The interaction policy path therefore uses its configured/default
trust level as an application value. A dedicated database column
should only be introduced when the reputation subsystem defines the
authoritative source.

### 4. `LOGICAL_MODEL_SPECIFICATION.md`

The documentation references
`docs/architecture/LOGICAL_MODEL_SPECIFICATION.md`. Its presence and
version/status should be explicitly verified before treating the
logical model as confirmed.

### 5. Secret rotation

The Meta App Secret, the ngrok authtoken, the System User token, and
the derived Page Access Token have all appeared in the development
chat. Rotate every one of them before external collaboration or
broader credential distribution. See the "Security note" in the Meta
App configuration section.

### 6. Ngrok URL is ephemeral

The recorded free ngrok URL changes when the tunnel is restarted. The
Meta Webhook callback configuration therefore has to be updated after
a restart. For stable long-running development, use a fixed public
HTTPS endpoint or a static ngrok domain.

---

## Next steps

The baseline Phase 19 (Meta publisher adapter and reconciliation) is
complete. The next major milestone in the baseline roadmap is:

### v1.3 --- `webhook_endpoints` and multi-page Meta support

The current `webhook_subscriptions` table duplicates the App-level
verify token per subscription. In v1.3 this is refactored into a new
`webhook_endpoints` table that owns the App-level verify token, and
`webhook_subscriptions` references the endpoint instead of duplicating
the token. This is an **aggregate boundary** change, not a table
addition: it affects the verification flow, the credential rotation
flow, the admin configuration UI, the audit trail, the repository
layer, the service layer, and the migration layer.

See `DATABASE_SCHEMA_CONTRACT.md` v1.2, deferred decision D-013.

### Secondary items (not blocking v1.3)

The pending items above are non-blocking. They can be addressed in
any order, individually or as part of a broader hardening pass:

- The credential-path migration (`META_PAGE_ACCESS_TOKEN` →
  `MetaCredentialService`) is the highest-value pending item because
  it eliminates the last environment-based secret on the worker side.
- The interaction-response configuration (`system_config` load) is
  the second-highest-value because it activates the policy engine
  beyond its current fail-closed default.

---

## Architectural invariants (must not be violated)

1. PostgreSQL is the authoritative system of record.
2. Redis/BullMQ is the asynchronous execution layer.
3. Every durable domain transition that produces a side effect
   enqueues through `outbox_jobs` in the same PostgreSQL transaction.
4. No direct BullMQ enqueue is permitted on a durable-write hot path.
5. The webhook ingress performs exactly one database transaction per
   HTTP request and no Redis call on the hot path.
6. Provider credentials are encrypted at rest with application-managed
   keys. No plaintext secret is persisted in any ordinary application
   table.
7. `outbox_jobs` has no foreign keys.
8. Reconciliation is mandatory for every state machine that has an
   external side effect.
9. The system fails closed when mandatory validation cannot be
   completed.
10. Publication reconciliation must remain separate from interaction
    response reconciliation at the domain/service boundary.
11. The publisher adapter is not the application foundation;
    provider-specific code remains behind narrow publisher/interaction
    interfaces.
12. The publication scheduler must perform the row state transition
    and the outbox enqueue in a single transaction with `FOR UPDATE
SKIP LOCKED` claim semantics. No scheduler scan may enqueue
    without claiming, and no claim may persist without enqueueing.
13. The publication worker must use a single atomic claim
    (`claimForPublishing`) to move a row to `IN_PROGRESS`. Two
    separate unguarded updates are not sufficient and can produce a
    duplicate external post under concurrency.

---

## Known patterns and traps

These are lessons learned during Phases 14–19e. They are captured
here so the next session does not re-encounter them.

### Stale workspace `dist/*.d.ts` can hide source changes

The worker consumes workspace packages through their package exports,
which may resolve to generated `dist` declarations. Therefore a source
file can contain a newly exported type or method while the worker
still sees an older declaration file.

When TypeScript reports that an existing workspace export or method is
missing, first rebuild the producing workspace packages:

```text
pnpm build
```

Only after the generated declarations are current should the error be
treated as a real source-level or architectural defect.

### `postgres.js` cannot serialize `Date` in `client.sql`

The `postgres.js` driver does not accept a JavaScript `Date` object
for a `timestamptz` parameter when the query is a raw `client.sql`
template literal. The failure surfaces as:

```text
TypeError: The "string" argument must be of type string or an instance
of Buffer or ArrayBuffer. Received an instance of Date
```

Two correct patterns:

1. Convert to ISO string and cast explicitly:
   `${draft.occurredAt.toISOString()}::timestamptz`
2. Use Drizzle's `tx.insert(...)` builder instead of raw SQL when the
   value is a `Date`.

Never pass a `Date` directly into a raw `client.sql` template literal.

### `RETURNING *` in raw SQL returns snake_case

Every raw SQL query with `RETURNING *` returns snake_case column
names that do not match the Drizzle `$inferSelect` type.

Two correct patterns:

1. `RETURNING id` in raw SQL, then a Drizzle `SELECT` for the full
   row.
2. Explicit `RETURNING id AS "id", col AS "camelCase"` aliases.

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

Fastify parses `application/json` into an object by default, losing
the raw bytes needed for HMAC-SHA256 verification.

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
configuration. The native config loader path is not compatible with
the old pattern.

### `source .env` is unreliable in Git Bash

The Neon and Upstash URLs can contain `&`, which Git Bash interprets
as a background-job separator.

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
63-character identifier limit. This is informational when the
generated migration is otherwise correct.

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
attempt or become the normal success path.

### Push reconciliation must not enter interaction policy

When `WebhookProcessService` receives a feed interaction whose actor
is the destination Page itself, it represents the platform's own
outbound action. That event must be handled as reconciliation and must
not continue into the normal interaction policy decision path.

### The publication scheduler must be idempotent across runs

The scheduler does not own the durable state; it only discovers and
enqueues. The `FOR UPDATE SKIP LOCKED` claim guarantees at-most-once
claiming across concurrent scheduler instances, and the transition
itself (`SCHEDULED → RESERVED` or `updated_at = now()`) removes the
row from the next scan's window. A repeated `runOnce()` on the same
set of rows must yield zero additional outbox rows.

### BullMQ `jobId` dedup across all job states

BullMQ deduplicates `queue.add()` by `jobId` **across every job
state**: `waiting`, `active`, `delayed`, `completed`, `failed`. If a
job with the same `jobId` still exists in Redis in any state, the
`add()` call is a silent no-op.

This matters because the outbox pattern uses deterministic `jobId`
values (`content.publish:{publicationId}`, etc.) so that a recovered
outbox row produces the same job on re-enqueue. If the previous job
is still retained as `completed`, the recovery silently fails: the
outbox row is marked `DISPATCHED` (the `add()` did not throw), but no
BullMQ job is created, and the worker never picks the work up.

**The correct configuration is:**

```typescript
defaultJobOptions: {
  removeOnComplete: true,
  removeOnFail: false,
}
```

- `removeOnComplete: true` removes the job immediately when it
  completes, so the `jobId` becomes reusable.
- `removeOnFail: false` keeps failed jobs for inspection. A failed
  job still blocks re-enqueue with the same `jobId`; this is
  deliberate, because failed jobs are exceptional and require
  investigation rather than silent retry.

The durable history of every external side effect already lives in
the database (`publication_attempts`, `webhook_deliveries`,
`interaction_response_attempts`,
`interaction_response_reconciliations`). Nothing is lost by removing
completed jobs immediately.

**Diagnostic:**

When a `DISPATCHED` outbox row produces no worker activity, inspect
the BullMQ queue state:

```bash
export REDIS_URL="$(grep '^REDIS_URL=' .env | cut -d= -f2-)"
node apps/worker/scripts/inspect-bullmq.mjs content.publish "content.publish:{publicationId}"
```

If the specific job shows `state=completed`, the dedup trap is
active. If the queue is empty and the job is `NOT FOUND`, the
dispatcher never successfully enqueued (or the job was already
removed).

### Publication `RESERVED` is a valid pre-execution state

The 19d scheduler transitions `SCHEDULED → RESERVED` before enqueuing
`content.publish`. Any worker guard that gates execution on the
publication status must include `RESERVED` in the eligible set,
alongside `SCHEDULED` (direct enqueue / `system.rebuild`) and `RETRY`
(re-enqueue after transient failure).

The `IN_PROGRESS` transition must be a single atomic claim
(`claimForPublishing`) with a status predicate in the `WHERE` clause.
Two separate unguarded updates are not sufficient.

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
