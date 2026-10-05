# Handoff — Project State

This document records the project state at a milestone boundary. It is
intended to be read first when resuming work in a new session.

**Snapshot date:** 2026-10-05
**Last commit:** `4ff04af` (feat(database): complete v1.3.1 CONTRACT migration (0018))
**Repository:** https://github.com/ARTeomo/content-platform

---

## Milestone: v1.3.1 contract completion

The `DATABASE_SCHEMA_CONTRACT.md` v1.3.1 is now **FINAL** and the DB
has been migrated to the v1.3.1 target state. This milestone covers the
two aggregate-boundary changes (D-013 `webhook_endpoints`, D-016
provider-aware natural key), the AAD-form correction in the Meta setup
runbook, and the completion migration (`0018`) that closes the schema
target.

### Commits

| Commit    | Subject                                                                               |
| --------- | ------------------------------------------------------------------------------------- |
| `d065190` | `feat(database): add webhook_endpoints schema and 0015 expand migration`              |
| `72faff0` | `feat(database): webhook_endpoints repository and endpoint_id wiring`                 |
| `cb9fcee` | `feat(api): dual-read verify-token handshake (endpoint-first, subscription-fallback)` |
| `5750131` | `feat(database): add external_interactions.provider (v1.3 EXPAND)`                    |
| `a6dd914` | `feat(database): v1.3 CONTRACT — webhook_endpoints + provider natural key`            |
| `c4f5c55` | `docs(operations): correct webhook verify-token AAD form`                             |
| `da4be5a` | `docs(database): finalize DATABASE_SCHEMA_CONTRACT v1.3.1`                            |
| `4ff04af` | `feat(database): complete v1.3.1 CONTRACT migration (0018)`                           |

**CI note.** The GitHub Actions run for `4ff04af` was queued during a
GitHub-side incident on 2026-10-05. The job never started; the
failure recorded in the Actions UI is an infrastructure error, not a
repository defect. See the "GitHub Actions runner allocation can fail
during incidents" trap below. When the incident is resolved, re-run
the workflow from the run page.

### What v1.3.1 changes

**D-013 — App-level webhook configuration aggregate.**

A new `webhook_endpoints` table owns the App-level verify token. The
`webhook_subscriptions` table references the endpoint via `endpoint_id`
instead of duplicating the verify token per subscription. This is an
**aggregate-boundary** change, not a table addition.

**D-016 — Provider-aware natural key.**

The natural external identity of `external_interactions` changes from
`(interaction_type, external_interaction_id)` to
`(provider, external_interaction_id)`. The old composite unique index is
dropped and replaced by `external_interactions_provider_external_id_uq`,
a **UNIQUE INDEX** (not a `UNIQUE CONSTRAINT`).

**AAD change.**

The webhook verify token AAD is now endpoint-scoped:

```text
Legacy (v1.2, migration-window only):
  META:WEBHOOK_VERIFY_TOKEN:<destination_id>

Target (v1.3.1):
  META:WEBHOOK_VERIFY_TOKEN:<endpoint_id>
```

The `WebhookTokenEncryptionProvider` supports both forms; the API
handshake uses endpoint-first verification with subscription fallback.

**Schema target state (reached).**

| Property                                         | v1.2                                          | v1.3.1 target                         |
| ------------------------------------------------ | --------------------------------------------- | ------------------------------------- |
| Tables                                           | 44                                            | **45**                                |
| Migrations                                       | 15 (`0000`–`0014`)                            | **19 (`0000`–`0018`)**                |
| `webhook_endpoints`                              | —                                             | **present**                           |
| `webhook_subscriptions.endpoint_id`              | —                                             | **NOT NULL**                          |
| `webhook_subscriptions.verify_token_encrypted`   | present                                       | **removed**                           |
| `webhook_subscriptions.verify_token_key_version` | present                                       | **removed**                           |
| `webhook_subscriptions.last_rotated_at`          | present                                       | **removed**                           |
| `external_interactions.provider`                 | nullable                                      | **NOT NULL**                          |
| `external_interactions` natural key              | `(interaction_type, external_interaction_id)` | `(provider, external_interaction_id)` |
| `provider_credentials` unique index              | `COALESCE` expression index                   | **two partial unique indexes**        |

### Migration chain

```text
0000  foundation:  pgcrypto, roles, users, destinations
0001  outbox:      outbox_jobs
0002  webhook:     webhook_subscriptions, webhook_subscription_health,
                   webhook_events, webhook_deliveries, external_interactions
0003  ingestion A: sources, source_endpoints, source_endpoint_health
0004  ingestion B: discovered_resources, discovery_observations,
                   provenance_events, raw_resources
0005  content A:   stories, content_items, content_versions, source_items
0006  content B:   content_entities, content_categories,
                   content_fingerprints, duplicate_matches,
                   content_urls, story_members
0007  media:       images, image_rights
0008  publication: publication_candidates, moderation_actions,
                   publications, publication_attempts,
                   publication_reconciliations
0009  deferred FK: external_interactions.publication_id → publications.id
0010  credential:  provider_credentials
0011  interaction: interaction_responses, interaction_response_attempts,
                   interaction_moderation_actions,
                   interaction_response_reconciliations
0012  config:      system_config, config_audit_log
0013  seed:        interaction_response_rules, templates, rate-limit keys
0014  seed:        meta.rate_limit.budgets
0015  v1.3 expand: webhook_endpoints; webhook_subscriptions.endpoint_id
                   (nullable); endpoint_id FK and index
0016  v1.3 expand: external_interactions.provider (nullable);
                   transitional non-unique index
0017  v1.3 contract: backfill provider = 'META';
                   drop webhook_subscriptions_key_version_check;
                   drop external_interactions_type_external_id_uq;
                   drop external_interactions_provider_external_id_idx;
                   endpoint_id SET NOT NULL;
                   provider SET NOT NULL;
                   create external_interactions_provider_external_id_uq;
                   drop webhook_subscriptions.verify_token_encrypted;
                   drop webhook_subscriptions.verify_token_key_version
0018  v1.3.1 complete: drop webhook_subscriptions.last_rotated_at;
                   drop provider_credentials_unique (COALESCE);
                   create provider_credentials_app_uq (partial);
                   create provider_credentials_destination_uq (partial)
```

**Note:** the v1.3.1 contract specifies a four-phase migration protocol
(`0015`–`0018` with a Compatibility Bridge deployment state and Hard
Gates). The current migration chain implements the same target state
via a three-phase equivalent (`0015`–`0017`) plus a completion
migration (`0018`) for the two remaining schema gaps. The
Compatibility Bridge and Hard Gate phases were not implemented because
the development database was recreatable. A production deployment on a
populated v1.2 database requires the full four-phase protocol from
`DATABASE_SCHEMA_CONTRACT.md` v1.3.1 §20.

### Verified target state

The `drizzle.__drizzle_migrations` table contains 19 rows (`0000`–`0018`).
The `_journal.json` contains 19 entries. Both are in sync.

Verified after migration:

- ✅ `webhook_endpoints` exists with all v1.3.1 columns.
- ✅ `webhook_subscriptions.endpoint_id` is NOT NULL.
- ✅ `webhook_subscriptions.verify_token_encrypted` is gone.
- ✅ `webhook_subscriptions.verify_token_key_version` is gone.
- ✅ `webhook_subscriptions.last_rotated_at` is gone.
- ✅ `external_interactions.provider` is NOT NULL.
- ✅ `external_interactions_provider_external_id_uq` exists.
- ✅ `external_interactions_type_external_id_uq` is gone.
- ✅ `provider_credentials_unique` (COALESCE) is gone.
- ✅ `provider_credentials_app_uq` (partial) exists.
- ✅ `provider_credentials_destination_uq` (partial) exists.

### E2E verification

A synthetic webhook POST was sent to the running API, and the full
pipeline processed it end-to-end against the real PostgreSQL and Redis
instances:

```text
curl POST → HTTP 200 OK
  ↓
webhook_events:        status = PROCESSED
  ↓
outbox_jobs:           queue_name = webhook.process, status = DISPATCHED
  ↓
external_interactions: interaction_type = COMMENT
  ↓
webhook_deliveries:    status = SUCCESS, error_category = null
```

The worker log confirmed:

```text
[webhook.process] event be485d4f-d137-4cd0-a416-28d42137849b processed: 1 interactions
```

This verifies the entire inbound path from ingress to materialization.

### Operational notes

**`drizzle-kit migrate` does not read `.env`.**

The `drizzle.config.ts` reads `process.env.DATABASE_URL`. The
`pnpm db:migrate` script does not load `.env` automatically. Export the
variable first:

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '\"')"
pnpm db:migrate
```

Or run inline:

```bash
DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '\"')" pnpm db:migrate
```

**Never echo environment variable values.**

`DATABASE_URL`, `META_APP_SECRET`, `WEBHOOK_TOKEN_ENCRYPTION_KEY`, and
`META_CREDENTIAL_ENCRYPTION_KEYS` must never be echoed to the console,
even partially. To verify a variable is set:

```bash
[ -n "$DATABASE_URL" ] && echo "DATABASE_URL: set" || echo "MISSING"
```

To check length only:

```bash
echo "DATABASE_URL length: ${#DATABASE_URL}"
```

The `inspect-migrations.mjs` script (added in `4ff04af`) prints schema
metadata only and never touches environment values.

**Helper script.**

`packages/database/scripts/inspect-migrations.mjs` reports the applied
migration list, public table list, and the column/index state of the
v1.3.1-relevant tables. Run it from `packages/database`:

```bash
cd packages/database
node --env-file=../../.env scripts/inspect-migrations.mjs
```

---

## Milestone: Phase 20 Sprint D + E — readiness audit follow-ups

Sprint D closed the `minIntervalSeconds` enforcement gap identified in
the follow-up review of the baseline audit. Sprint E closed three
additional findings (N5, N6, N10) identified by the v1.3 readiness
audit.

### Sprint D — `minIntervalSeconds` enforcement

The `interaction_response.min_interval_seconds` key was loaded from
`system_config` into `InteractionResponseConfig`, but the policy engine
never enforced it. The policy input did not carry the minimum interval,
and `DefaultPolicyEngine.decide()` had no check for elapsed time since
the last response.

The fix extended `PolicyInput` with `minIntervalSeconds` and
`secondsSinceLastResponse`, added step 4 to `DefaultPolicyEngine.decide()`,
and introduced `InteractionResponsesRepository.findLastRespondedAtByDestination`.
The interaction response service now fetches the timestamp and computes
the elapsed seconds before constructing the policy input.

### Sprint E — credential gate coverage, notifications, README

Three items from the readiness audit:

- **N5** — the scheduler credential gate had zero test coverage.
  Nine new tests now cover VALID / EXPIRING / INVALID / UNKNOWN,
  health-check failure, missing credential service, notification
  emission, one-check-per-destination, and mixed-batch behavior.
- **N10** — the gate's `markFailed` path emitted no notification.
  `AlertingService.publicationBlocked` was added and is called from
  the scheduler after the scan transaction commits.
- **N6** — the README was stale relative to the Phase 20 state. It
  now reflects Phase 20 completion, the CI pipeline, and the current
  test counts.

### Audit trail

Three audit documents are recorded:

- `docs/audit/baseline-audit-2026-09-20.md` — the original baseline
  audit, superseded, kept for reference.
- `docs/audit/sprint-audit-2026-10-03.md` — the Phase 20 remediation
  report. All seventeen findings closed except `audit_logs` (deferred
  to the admin UI milestone).
- `docs/audit/v1-3-readiness-audit-2026-10-04.md` — the pre-v1.3
  audit. CONDITIONAL PASS with four plan-level corrections (N1–N4)
  and three repository-level follow-ups (N5, N6, N10). All three are
  now closed.

### v1.3 development plan

The original v1.3 plan is committed at
`docs/planning/v1-3-development-plan-2026-10-04.md`. It recorded the
corrected starting facts (migration numbering from `0015`, real AAD
binding `META:WEBHOOK_VERIFY_TOKEN:<destination_id>`, F5a/F6
re-scope), the three-migration structure (`0015`–`0017`), and the
scope boundary.

This plan is **superseded by the v1.3.1 contract** at
`docs/architecture/DATABASE_SCHEMA_CONTRACT.md`. The contract defines
a four-phase migration protocol with a Compatibility Bridge and Hard
Gates; the actual implementation used a three-phase equivalent plus a
completion migration. A production upgrade on a populated v1.2
database requires the full four-phase protocol from the contract.

---

## Milestone: Phase 20 Sprint C — observability and system queues

Sprint C closes the remaining three operational findings from the
baseline audit. The scope is deliberately narrow: no new domain
behavior, only the operational and observability primitives that were
specified in the Technical Specification but never wired into the
worker.

### Findings addressed

| #   | Finding                                             |
| --- | --------------------------------------------------- |
| F7  | `system.rebuild` and `system.outbox.cleanup` queues |
| F11 | `notifications` table is never written              |
| F12 | `system_logs` and `audit_logs` are never written    |

### F7 — system queues

Two new queues and their workers.

**`system.rebuild`.** A safety net for the case where BullMQ state is
lost (Redis wipe, queue corruption) while durable PostgreSQL state
still reflects work that should be in flight. It scans three
entities — stale RECEIVED `webhook_events`, due SCHEDULED
`publications`, due SCHEDULED `interaction_responses` — and re-enqueues
the corresponding jobs with a `:rebuild:<epoch_ms>` suffix. The
suffix guarantees the rebuild never collides with the primary
scheduler's job_ids, and the outbox `enqueue` is idempotent on
`job_id`. The service deliberately does **not** reset entity statuses:
downstream workers already have atomic claim guards, so a duplicate
rebuild cannot produce duplicate external side effects.

**`system.outbox.cleanup`.** The cleanup of old DISPATCHED outbox rows
is no longer a timer inside the dispatcher. It is a dedicated queue
and worker, and a scheduler enqueues one job per hour (configurable
via `SYSTEM_OUTBOX_CLEANUP_INTERVAL_MS`). This removes the race that
would otherwise occur when multiple dispatcher instances run
concurrently and each tries to DELETE the same rows.

Both queues are triggered by command-line scripts:

- `packages/database/scripts/trigger-system-rebuild.mjs`
- `packages/database/scripts/trigger-outbox-cleanup.mjs`

### F11 — notifications

A `NotificationService` writes to the `notifications` table from the
worker. Alerts are best-effort: a DB write failure is logged but never
propagates, so an alert can never mask a business outcome.

Currently wired:

- `credential_failure` — a PAGE_ACCESS_TOKEN is invalidated via
  `shouldInvalidateCredential`.
- `publication_failure` — a publication reaches the FAILED state.

`AlertingService` combines each notification with a matching
`system_logs` entry so operators have both a short-term alert and a
durable forensic record.

### F12 — system logs and audit logs

A `SystemLogService` writes to `system_logs`. Only high-value events
belong here: durable business state transitions such as
`publication.published`, `publication.failed`, `credential.invalidated`.
Routine worker tracing remains on stdout.

The `audit_logs` table is intentionally left without a writer in
Sprint C. It is reserved for actor-initiated changes from the admin
UI, which does not yet exist. The technical specification records
this as a deferred decision; Sprint C does not change it.

---

## Milestone: Phase 20 Sprint B — audit findings F1–F16 addressed

The baseline audit identified 17 findings across the Sprint B scope.
Of those, nine are closed and covered by tests. The remaining eight
are either lower-priority operational gaps or planned for a later
milestone. The work proceeded as five independent commits, each
addressing one logical cluster of findings.

### Commits

| Commit    | Findings addressed                               |
| --------- | ------------------------------------------------ |
| `90e210c` | F2, F5, F6, F8, F9 — worker runtime wiring       |
| `16675be` | F1 — webhook ingress single-transaction boundary |
| `b32c2cd` | F10, F13, F16 — webhook token encryption         |
| `4849440` | F3, F4 — Redis-backed Meta rate limiters         |
| `3373895` | F14, F15 — atomic claims for event and response  |

### F1 — webhook ingress transaction boundary

The POST route now performs a single database transaction per HTTP
request. The destination lookup, the `webhook_events` insert, and the
`outbox_jobs` enqueue all happen inside one `txManager.run()` block.
Signature verification, JSON parsing, and Zod validation run before
the transaction and touch no database state.

### F2 — interaction response config from `system_config`

`InteractionResponseService` receives its rule set, templates, and
rate limits from the `system_config` table. A new
`SystemConfigRepository` exposes typed reads. The worker loads
configuration at startup and logs which keys defaulted when the DB
is unreachable or a key is absent. Seed migration
`0013_seed_system_config.sql` inserts the initial values.

### F3 / F4 — Redis-backed Meta rate limiters

`RedisMetaRateLimiter` replaces `NoopMetaRateLimiter` on both
`MetaInteractionAdapter` (`pages_manage_engagement`) and
`MetaPublisherAdapter` (`pages_manage_posts`). Enforcement uses a
sliding-window sorted-set algorithm implemented as a single Lua
script, so all three budgets (per-destination hourly, global hourly,
global daily) are checked atomically. The limiter fails closed when
Redis is unreachable.

### F5 — DB-backed Meta credentials in the worker

`MetaCredentialService` is now constructed in the worker bootstrap
and wired into every adapter via `buildGetAccessToken`. The legacy
`META_PAGE_ACCESS_TOKEN` environment variable remains as a
deprecation-warned fallback while credentials are migrated. Every
fallback use is logged at warn level.

### F6 — scheduler credential-health gate

`PublicationSchedulerService` consults `healthCheck(destinationId)`
before enqueuing `content.publish`. Destinations with an INVALID
overall credential status are moved to FAILED instead of looping on
401 responses.

### F8 — interaction response scheduler

`InteractionResponseSchedulerService` and its worker close the
lifecycle gap. SCHEDULED responses are enqueued to `webhook.respond`;
stale IN_PROGRESS responses are enqueued to
`webhook.respond.reconcile`. Both scans use `FOR UPDATE SKIP LOCKED`
and perform the state change and the outbox enqueue in one
transaction.

### F9 — credential invalidation propagation

`shouldInvalidateCredential` is threaded from the Meta adapters
through `ContentPublishService` and `WebhookRespondService` to the
workers, which call `invalidatePageAccessToken` best-effort before
completing the job.

### F10 / F13 / F16 — webhook token encryption

The API no longer carries its own AES-256-GCM implementation. A new
`WebhookTokenEncryptionProvider` in `@content-platform/authentication`
wraps the existing `CredentialEncryptionProvider` with the webhook
specific AAD context. In v1.3.1 the provider supports both the legacy
destination-scoped AAD (`META:WEBHOOK_VERIFY_TOKEN:<destinationId>`)
and the target endpoint-scoped AAD
(`META:WEBHOOK_VERIFY_TOKEN:<endpointId>`). The subscription's
`verify_token_key_version` is read from the row and selects the
decryption key, enabling key rotation without downtime. `safeEqual`
provides timing-safe comparison for the incoming verify token.

### F14 / F15 — atomic claims

`WebhookEventsRepository.claimForProcessing` transitions an event
from RECEIVED to PROCESSING in a single guarded UPDATE. A second
worker racing on the same event sees `false` and exits without
creating a delivery attempt.

`InteractionResponsesRepository.createIdempotent` returns
`{ row, inserted }`. The interaction response service only enqueues
the `webhook.respond` outbox job when `inserted === true`, avoiding
the outbox `job_id` unique-constraint collision that would otherwise
occur under concurrency.

### Findings still open

None. Sprint C closed F7, F11, and F12. Two additional gaps
surfaced during the closing review and were closed in follow-up
commits:

- **F8 — reconciliation gap.** The interaction response scheduler
  covered stale `IN_PROGRESS` rows but not stale `UNKNOWN` rows.
  A response whose provider call returned a network error was
  left in `UNKNOWN` and never reconciled. The scheduler now claims
  both statuses via `touchStaleUnresolved`. Commit `c9b13e7`.

- **F17 — worker dev script.** `apps/worker/package.json` lacked a
  `dev` script while `apps/api` had one. Commit `76410d8`.

The `audit_logs` table remains without a writer by design; it is
reserved for actor-initiated changes from the admin UI, which does
not yet exist.

### Drizzle snapshot chain

The `drizzle-kit generate` tool was broken after the Sprint C
seed-only migrations. `0013_seed_system_config` and
`0014_seed_rate_limit_budgets` added `_journal.json` entries but no
matching `_snapshot.json` files, so the next schema change would
have had no `prevId` anchor. Both snapshot files were created by
copying `0012_snapshot.json` and refreshing the `id`/`prevId`
chain. Commit `76410d8`.

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

**Phase 19 is now complete.** The next milestone is v1.3.1, which is
documented at the top of this file.

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
| Ngrok URL (recorded)    | `https://uncanny-reappoint-unaligned.ngrok-free.dev` |

Database records created during the Phase 18a E2E test:

| Table                      | ID                                     |
| -------------------------- | -------------------------------------- |
| `destinations.id`          | `51eb5e79-b6a5-4f51-86bb-23dd81e9167e` |
| `webhook_subscriptions.id` | `2bc850b3-3e93-45d7-98cd-45e07a2daf00` |

**v1.3.1 note.** After the v1.3.1 completion migration (`0018`), the
`webhook_subscriptions.verify_token_*` and `last_rotated_at` columns no
longer exist. The verify token is owned by `webhook_endpoints`. The
`webhook_subscriptions.id` above will need a corresponding
`webhook_endpoints.id` after migration; the token rotation and
endpoint-upsert rules from `DATABASE_SCHEMA_CONTRACT.md` v1.3.1
INVARIANT-17 and INVARIANT-18 apply.

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

| Package                         | Purpose                                                                                                               | Tests   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------- |
| `packages/database`             | Drizzle schema, migrations, repositories, TransactionManager                                                          | 28      |
| `packages/authentication`       | AES-256-GCM, MetaCredentialService, Graph API client                                                                  | 37      |
| `packages/interaction-response` | Policy engine, template renderer (pure, deterministic)                                                                | 26      |
| `packages/publishers`           | MetaInteractionAdapter, MetaPublisherAdapter, MetaResponseReconciler, MetaPublicationReconciler, RedisMetaRateLimiter | 56      |
| `apps/worker`                   | OutboxDispatcher, publication scheduler, interaction response scheduler, system queues, observability services        | 111     |
| `apps/api`                      | Fastify webhook ingress (POST + GET), handshake                                                                       | 10      |
| **Total**                       |                                                                                                                       | **268** |

Test file count: 31 across the six packages. The 268-test verification
is recorded with `TEST_DATABASE_URL` and `TEST_REDIS_URL` available.
Without those, the DB- and Redis-backed tests skip.

### Database schema — v1.3.1 target state

- **45 tables** implementing DB v1.3.1.
- **19 migrations** (`0000` – `0018`), applied to Neon PostgreSQL.
- `pgcrypto` extension registered in `0000`, never re-declared.
- `webhook_endpoints` created by `0015`.
- `webhook_subscriptions.endpoint_id` NOT NULL after `0017`.
- `webhook_subscriptions.verify_token_encrypted` and
  `verify_token_key_version` dropped by `0017`.
- `webhook_subscriptions.last_rotated_at` dropped by `0018`.
- `external_interactions.provider` NOT NULL after `0017`.
- `external_interactions_provider_external_id_uq` created by `0017`.
- `provider_credentials` uses two partial unique indexes
  (`provider_credentials_app_uq`,
  `provider_credentials_destination_uq`) since `0018`.
- Deferred FK `external_interactions.publication_id` →
  `publications.id` (created by `0009`).

### Repositories implemented

There are **16 repository classes** currently exported by
`packages/database/src/repositories/index.ts`.

#### Webhook / outbox / destination

- `OutboxRepository` — `FOR UPDATE SKIP LOCKED` two-step claim.
- `WebhookEndpointsRepository` (v1.3.1).
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

- `ProviderCredentialsRepository` — protected by the two partial
  unique indexes.

#### Interaction response lifecycle

- `InteractionResponsesRepository` — includes `claimForResponding`
  and `findByDestinationAndExternalResponseId`.
- `InteractionResponseAttemptsRepository`.
- `InteractionModerationActionsRepository`.
- `InteractionResponseReconciliationsRepository`.

All repository integration tests with a database dependency run
against Neon PostgreSQL when `TEST_DATABASE_URL` is configured.

**Wiring gap.** `WebhookSubscriptionHealthRepository` and
`InteractionModerationActionsRepository` are **not yet wired into
`apps/worker/src/index.ts`**. This means:

- `webhook_subscription_health` rows are not written by the worker.
- Interaction moderation decisions are not persisted to
  `interaction_moderation_actions`.

Both are targeted fixes; the repository implementations exist and are
tested in isolation.

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
- `InteractionResponseSchedulerService` — SCHEDULED and stale
  IN_PROGRESS/UNKNOWN interaction response orchestration.
- `InteractionResponseSchedulerWorker` — polling wrapper.
- `MetaCredentialService` — credential store, rotation,
  invalidation, validation, and health checks.
- `MetaErrorMapper` — Graph API error categorization.
- `CredentialEncryptionProvider` — AES-256-GCM with AAD binding and
  key rotation.
- `WebhookTokenEncryptionProvider` — wraps the credential provider
  with the webhook-specific AAD contexts (legacy destination AAD and
  target endpoint AAD).

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

The `GET /api/v1/webhooks/meta` handshake is implemented with dual-read
semantics:

1. `hub.mode` must be `subscribe`; `hub.verify_token` and
   `hub.challenge` are required.
2. **Endpoint-first path:** all `webhook_endpoints` rows where
   `provider = 'META' AND status = 'ACTIVE'` are loaded and decrypted
   with AAD `META:WEBHOOK_VERIFY_TOKEN:<endpoint_id>`.
3. **Subscription fallback:** all `webhook_subscriptions` rows where
   `provider = 'META' AND status = 'ACTIVE'` are loaded and decrypted
   with AAD `META:WEBHOOK_VERIFY_TOKEN:<destination_id>`.
4. Ciphertext format is `v1:base64(iv ‖ ciphertext ‖ tag)` using
   AES-256-GCM.
5. On match, `last_verified_at` is updated on the matched record and
   `hub.challenge` is returned as plain text.
6. On mismatch, HTTP 403 is returned.

After the `0018` migration, the endpoint path is the only remaining
path in the schema; the subscription-scoped AAD remains valid only for
the migration window.

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
- `SystemRebuildWorker` — `system.rebuild`.
- `SystemOutboxCleanupWorker` — `system.outbox.cleanup`.
- `SystemOutboxCleanupSchedulerWorker` — hourly enqueue of cleanup
  jobs.
- `InteractionResponseSchedulerWorker` — periodic polling of
  `SCHEDULED` and stale `IN_PROGRESS`/`UNKNOWN` responses.
- `NotificationService`, `SystemLogService`, `AlertingService`.
- `MetaCredentialService` (via `buildMetaCredentialService`).
- `RedisMetaRateLimiter`.
- `MetaPublisherAdapter` and `MetaInteractionAdapter` (via
  `MetaGraphBridge`).
- Graceful shutdown in dependency order.

Worker boot log (verified 2026-10-05):

```text
[worker] interaction response: 0 rules, 0 templates
[worker] rate limits: publish=10/h/dest, engagement=30/h/dest
[worker] DB-backed Meta credentials available
[worker] started
[system.outbox.cleanup.schedule] started (interval=3600000ms)
[interaction-response.schedule] scheduler started (interval=30000ms)
[publication.schedule] scheduler started (interval=30000ms)
[outbox] dispatcher started
```

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
- `docs/architecture/DATABASE_SCHEMA_CONTRACT.md` — **v1.3.1 final**
- `docs/architecture/LOGICAL_MODEL_SPECIFICATION.md` — status
  unconfirmed
- `docs/architecture/META_INTEGRATION_SPECIFICATION.md` — v1.4,
  partially superseded by v1.3.1
- `docs/conventions/`
- `docs/operations/README.md`
- `docs/operations/local-development.md`
- `docs/operations/meta-app-setup.md`
- `docs/planning/v1-3-development-plan-2026-10-04.md` — superseded
  by the v1.3.1 contract
- `docs/audit/baseline-audit-2026-09-20.md`
- `docs/audit/sprint-audit-2026-10-03.md`
- `docs/audit/v1-3-readiness-audit-2026-10-04.md`

---

## Pending items

### 1. `WebhookSubscriptionHealth` and `InteractionModerationActions` wiring

Both repositories exist and are tested in isolation but are **not yet
wired into `apps/worker/src/index.ts`**:

- `WebhookSubscriptionHealthRepository` — the
  `webhook_subscription_health` table is not written by the worker.
  The v1.2 F11 fix ("storage now, use later") currently has no
  writer, so "storage" is incomplete.
- `InteractionModerationActionsRepository` — interaction moderation
  decisions are not persisted to `interaction_moderation_actions`.
  The `WebhookRespondService` performs moderation but does not write
  the decision.

Both are targeted fixes. The repository implementations are correct
and tested; the wiring must be added to the worker bootstrap and the
relevant services.

### 2. TypeScript downgrade for ESLint compatibility

`pnpm lint` fails at module load because the project pins
TypeScript `7.0.2` (in `pnpm-workspace.yaml`) and
`typescript-eslint@8.70.0` does not yet support the TS 7 compiler
API. The failure is:

```text
typescript-eslint does not support TS 7.0.
Please see https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0
```

Tracked upstream at
[typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940).

The CI workflow (`.github/workflows/ci.yml`) intentionally does
not run the lint step for this reason. The other checks —
`pnpm format:check`, `pnpm typecheck`, `pnpm test` — remain in CI
and protect the `main` branch.

**Recommended resolution:** downgrade TypeScript to 6.x. The
language is identical; TS 7 is a compiler rewrite. All tooling
(typescript-eslint, tsx, drizzle-kit, tsc) is compatible with
both. The downgrade touches `package.json`, `pnpm-workspace.yaml`,
`pnpm-lock.yaml`, and `.github/workflows/ci.yml`.

### 3. Meta credential fallback removal — v1.3 F5a

`MetaCredentialService` is wired into the worker. The
`META_PAGE_ACCESS_TOKEN` environment variable remains as a
deprecation-warned fallback for destinations without a DB-backed
credential. This is a **migration compatibility fallback**, not an
accidental leftover.

Removal is scheduled for v1.3 F5a. The scope is defined in
`docs/planning/v1-3-development-plan-2026-10-04.md` §5.1:
fallback removal, `refresh-page-token.mjs` DB-write conversion,
error-category preservation. No cache and no Pub/Sub — the
single-worker topology and the rate-limited API call pattern make
them unnecessary at this stage.

### 4. `destinations.trust_level`

The current database schema does not contain a `trust_level` column.
The interaction policy path therefore uses its configured/default
trust level as an application value. A dedicated database column
should only be introduced when the reputation subsystem defines the
authoritative source.

### 5. `LOGICAL_MODEL_SPECIFICATION.md` status

The documentation references
`docs/architecture/LOGICAL_MODEL_SPECIFICATION.md`. Its presence and
version/status should be explicitly verified before treating the
logical model as confirmed.

### 6. Secret rotation

The Meta App Secret, the ngrok authtoken, the System User token, and
the derived Page Access Token have all appeared in the development
chat. Rotate every one of them before external collaboration or
broader credential distribution. See the "Security note" in the Meta
App configuration section.

### 7. Ngrok URL is ephemeral

The recorded free ngrok URL changes when the tunnel is restarted. The
Meta Webhook callback configuration therefore has to be updated after
a restart. For stable long-running development, use a fixed public
HTTPS endpoint or a static ngrok domain.

### 8. Documentation drift reconciliation

The v1.3.1 contract explicitly supersedes statements in
`TECHNICAL_SPECIFICATION.md` v0.9.0 (§136) and
`META_INTEGRATION_SPECIFICATION.md` v1.4 (§5, §48). Additional drift
identified by follow-up audits affects:

- `META_INTEGRATION_SPECIFICATION.md` §9.8 (handshake description),
  §36 Layer 2 (natural key), §52 (baseline declaration), §2.2
  (version history).
- `TECHNICAL_SPECIFICATION.md` §84 (44-table inventory), §84.7
  (`webhook_subscriptions` columns), §84.11 (natural key), §84.12
  (`provider_credentials` COALESCE), §140.2 (handshake), §145
  (invariant 15), §147 (source-of-truth hierarchy).
- `docs/architecture/data-model.md`, `docs/architecture/domain-model.md`,
  `docs/architecture/README.md`, `docs/architecture/system-overview.md`
  (44→45 tables, missing `webhook_endpoints`, v1.2 natural key).
- `docs/adr/ADR-002-outbox-pattern.md` (BullMQ dedup overstatement,
  §5.43 → §5.45), `docs/adr/ADR-005-health-separation.md` (§5.44 →
  §5.36).
- `docs/operations/local-development.md` (migration count, test count,
  legacy encryption key format).

The minimal reconciliation is a "v1.3.1 compatibility note" at the top
of each affected document that lists the superseded statements and
points to the corresponding v1.3.1 sections. The full §-level revision
can proceed in parallel or later.

---

## Next steps

### Primary: two targeted wiring fixes

1. Wire `WebhookSubscriptionHealthRepository` into
   `WebhookProcessService` (or `WebhookEventsRepository`'s
   successful-processing path) so that `webhook_subscription_health`
   rows are written on delivery outcomes.
2. Wire `InteractionModerationActionsRepository` into
   `WebhookRespondService` (or `InteractionResponseService`) so that
   moderation decisions are persisted to
   `interaction_moderation_actions`.

Both fixes are small, isolated, and testable.

### Secondary: TypeScript downgrade

Downgrade TypeScript from `7.0.2` to `6.x` in `package.json` and
`pnpm-workspace.yaml`, regenerate `pnpm-lock.yaml`, re-enable the
`pnpm lint` step in `.github/workflows/ci.yml`, and close pending item
#2.

### Tertiary: documentation drift reconciliation

Apply the "v1.3.1 compatibility notes" to the affected higher-level
documents (pending item #8). This unblocks the v1.3.2 development plan
and removes the ambiguity about which document is authoritative for the
v1.3.1 schema.

### Quarterly: production Path A

If a populated v1.2 production database ever needs to migrate to
v1.3.1, the full four-phase protocol from `DATABASE_SCHEMA_CONTRACT.md`
v1.3.1 §20 must be implemented: Compatibility Bridge deployment, Hard
Gate #1 (SERIALIZABLE data validation + concurrent index catalog
validation + preservation evidence), Hard Gate #2, `0018 CONTRACT`
completion, partial-0016 recovery contract, immutable pre-migration
preservation baseline, and canonical-JSON preservation digest per
§2.8. The current migration chain (`0015`–`0017` plus `0018`) reaches
the same target state but does not implement the governance layer.

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
14. Every Meta Graph API call must pass through a `MetaRateLimiter`
    or `MetaPublishRateLimiter` before the HTTP request is issued.
    The limiter enforces per-destination, global hourly, and global
    daily budgets atomically. The limiter fails closed when Redis is
    unreachable: an inability to prove compliance is treated as a
    denial.
15. Every schema change must land in the `DATABASE_SCHEMA_CONTRACT`
    before the migration is written. The contract is the source of
    truth; migrations are generated from it. The v1.3.1 contract is
    the current level-3 baseline.

### Additional invariants introduced by the v1.3.1 contract

16. The App-level webhook verify token is owned by
    `webhook_endpoints`. No per-subscription duplication.
17. The target-state authoritative verify-token AAD is
    `META:WEBHOOK_VERIFY_TOKEN:<endpoint_id>`. The legacy
    destination-scoped AAD is migration-window-only.
18. The natural external identity of `external_interactions` is
    `(provider, external_interaction_id)`, enforced by a
    **UNIQUE INDEX** (`external_interactions_provider_external_id_uq`).
19. `interaction_responses.destination_id` is `NOT NULL` with
    `ON DELETE RESTRICT`.
20. `webhook_subscriptions.fields` is non-empty
    (`CHECK (cardinality(fields) > 0)`).
21. Exactly one Meta App per deployment.
22. Encryption keys are versioned; the legacy single-key model is
    compatibility-only.
23. Path A (upgrade) and Path B (greenfield) are distinct,
    non-mergeable migration flows.
24. The `0016` migration fence applies to all writers of
    `external_interactions`, `webhook_subscriptions`, and
    `webhook_endpoints`.
25. Historical durable business data is preserved byte-for-byte
    except for the transformations explicitly allowed in the contract.
26. Preservation evidence is verified, not merely asserted.
27. The authoritative outbox idempotency anchor is
    `outbox_jobs.job_id UNIQUE`. BullMQ `jobId` deduplication is a
    mitigation, not a guarantee.
28. The `0016` migration executes on a single dedicated session.
29. A `0016` failure after Step 1 leaves the deployment in the
    partial-0016 state, recoverable by re-running `0016` using the
    existing immutable baseline, never a recomputed one.
30. Multi-user access control within a shared deployment scope; no
    tenant isolation.

---

## Known patterns and traps

These are lessons learned during Phases 14–19e and v1.3.1
finalization. They are captured here so the next session does not
re-encounter them.

### `describe.skipIf(!TEST_DB_URL)` silently skips DB tests

The DB- and Redis-backed integration tests use the
`describe.skipIf(!TEST_DB_URL)` pattern. When the environment
variable is absent, the entire test file is skipped without any
warning in the standard test output.

The consequence: a default `pnpm test` run without
`TEST_DATABASE_URL` reports "green" while silently omitting half
the suite. The CI pipeline provides `TEST_DATABASE_URL` and
`TEST_REDIS_URL` via repository secrets, so the CI runs the full
suite; local developers must export the env vars explicitly.

When adding new integration tests, add the same pattern and remember
that a "passing" local run without the env vars does not exercise
the new tests.

### Prettier must run after any script-driven markdown edit

When a Node script prepends or modifies a markdown file — especially
a table — the change bypasses Prettier. `pnpm format` must be run
**before** the commit, otherwise the CI's `Format check` step
rejects the push.

This trap fires particularly often for:

- commit message scripts that write to a temporary file
- banner or status-section injections in audit files
- test-count or coverage-table updates

Always run `pnpm format` before `git commit`.

### Commitlint type list is narrower than the standard

The project's `commitlint.config.js` uses a reduced `type-enum`:

```text
feat fix refactor docs test perf build ci chore revert
```

Two types present in the standard Conventional Commits spec are
absent: `style` and `doc`. A commit whose subject starts with
`style:` or `doc(...):` is rejected by the hook, even though both
forms are valid under the broader spec.

For formatting-only changes, use `docs(<scope>):` for markdown
files and `chore:` for code files.

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

### `drizzle-kit migrate` does not read `.env`

The `drizzle.config.ts` reads `process.env.DATABASE_URL`. The `pnpm
db:migrate` script does not load `.env` automatically. Export the
variable first:

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '\"')"
pnpm db:migrate
```

Or run inline:

```bash
DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '\"')" pnpm db:migrate
```

Or via the workspace-local drizzle-kit binary from `packages/database`:

```bash
cd packages/database
DATABASE_URL="$(grep '^DATABASE_URL=' ../../.env | cut -d= -f2- | tr -d '\"')" pnpm exec drizzle-kit migrate
```

### Never echo environment variable values

`DATABASE_URL`, `META_APP_SECRET`, `WEBHOOK_TOKEN_ENCRYPTION_KEY`, and
`META_CREDENTIAL_ENCRYPTION_KEYS` must never be echoed to the console,
even partially. To verify a variable is set:

```bash
[ -n "$DATABASE_URL" ] && echo "DATABASE_URL: set" || echo "MISSING"
```

To check length only:

```bash
echo "DATABASE_URL length: ${#DATABASE_URL}"
```

Do not `echo "$DATABASE_URL"`, do not print a prefix, do not include a
variable value in commit messages or debug output.

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

### Drizzle snapshot chain breaks with seed-only migrations

Every `_journal.json` entry must have a matching
`NNNN_snapshot.json`, even when the migration contains only data
changes (INSERTs) and no DDL. Without it, the next `drizzle-kit
generate` fails because the tool cannot find a `prevId` anchor for
the new snapshot.

The fix is to copy the previous snapshot, assign a new `id`, and
set `prevId` to the previous snapshot's `id`. Two seed-only
migrations needed this treatment in Sprint C:
`0013_seed_system_config` and `0014_seed_rate_limit_budgets`.

Verification: after the fix,

```bash
pnpm --filter @content-platform/database exec drizzle-kit generate
```

must print `No schema changes, nothing to migrate`. If it produces
a new `NNNN_*.sql` file, the snapshot chain is not consistent with
the Drizzle schema definitions, and the new files must be removed
before continuing.

### GitHub Actions runner allocation can fail during incidents

The GitHub-hosted runner pool can be temporarily unavailable during
GitHub-side incidents. The symptom is a workflow run that stays in
`Queued` for an unusually long time and then fails with:

```text
Internal server error. Correlation ID: ...
The job was not acquired by Runner of type hosted even after multiple attempts
```

This is **not** a repository defect. The job never started. Check
<https://www.githubstatus.com/> for an active incident. When the
incident is resolved, re-run the workflow from the run page.

Do not push additional commits to work around the incident — that
only adds more queued runs.

### TypeScript 7 + ESLint compatibility

The project pins TypeScript 7.0.2. `typescript-eslint@8.70.0` does not
yet support the TS 7 compiler API. `pnpm lint` fails at module load:

```text
typescript-eslint does not support TS 7.0.
```

The CI workflow intentionally excludes the lint step. See pending
item #2 for the recommended resolution (downgrade to TS 6.x).

---

## Source-of-truth hierarchy

```text
1. Domain and architecture contracts
2. DB v1 Logical Model Specification v1.0
3. DATABASE_SCHEMA_CONTRACT.md v1.3.1   ← FINAL
4. Drizzle schema implementation
5. Generated PostgreSQL migrations
```

Any change to the physical schema requires revising the higher-level
contract first. The v1.3.1 contract is the current level-3 baseline
and is **final**.

The v1.3.1 contract explicitly supersedes statements in:

- `TECHNICAL_SPECIFICATION.md v0.9.0 §136`
- `META_INTEGRATION_SPECIFICATION.md v1.4 §5`
- `META_INTEGRATION_SPECIFICATION.md v1.4 §48`

Additional drift in the higher-level documents (identified by
follow-up audits) must be reconciled via compatibility notes or
§-level revisions before the v1.3.2 development plan is finalized.
