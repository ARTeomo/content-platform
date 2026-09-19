# Handoff — Project State

This document records the project state at a milestone boundary. It is
intended to be read first when resuming work in a new session.

**Snapshot date:** 2026-09-19
**Last commit:** `07b9367` (feat(worker): wire webhook respond worker and meta graph bridge)
**Repository:** https://github.com/ARTeomo/content-platform

---

## Milestone: Phase 18b complete — interaction response lifecycle

The complete two-way Meta integration is now closed. The platform can
receive inbound interactions, decide on an outbound response through a
deterministic policy engine, route it through a moderation gate, send
it via the Graph API, and reconcile uncertain outcomes through both
push and pull paths.

The full loop:

```
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
      b. push-reconciliation: actor == own Page → mark response RESPONDED
      c. otherwise: InteractionResponseService.decide(...)
           → AUTO_RESPOND path enqueues outbox job (queue_name = 'webhook.respond')
  → OutboxDispatcher
  → BullMQ webhook.respond queue
  → WebhookRespondWorker
  → WebhookRespondService
      → MetaInteractionAdapter → Graph API
      → on RETRY, BullMQ reschedules
      → on UNKNOWN, marked for pull reconciliation
  → (push reconciliation: our own reply reappears as a feed webhook)
  → (pull reconciliation: WebhookRespondReconcileWorker queries the
     parent comment's replies and matches by body)
```

Evidence:

```
99 passed | 0 failed | 47 skipped (DB-dependent)
6 workspace packages
13 repositories
4 workers wired into apps/worker/src/index.ts
```

The interaction response lifecycle adds:

- `packages/interaction-response` — pure, deterministic policy engine + template renderer
- `packages/publishers` — MetaInteractionAdapter, MetaResponseReconciler, NoopMetaRateLimiter
- 4 new repositories (`interaction_responses`, `interaction_response_attempts`, `interaction_moderation_actions`, `interaction_response_reconciliations`)
- 3 new services (`InteractionResponseService`, `WebhookRespondService`, `WebhookRespondReconcileService`)
- 2 new workers (`WebhookRespondWorker`, `WebhookRespondReconcileWorker`)
- 2 new queues (`webhook.respond`, `webhook.respond.reconcile`)
- Push-reconciliation hook integrated into `WebhookProcessService`
- `MetaGraphBridge` — HTTP POST + GET bridge from the worker to the Graph API

---

## Milestone: Phase 18a complete — real Meta E2E verified (2026-09-18)

The complete inbound Meta integration was verified end-to-end against
the **real Meta Graph API** in **Live** mode. A real comment on the
`contentplatform.dev` Page produced a real `external_interactions` row.

Evidence (real Meta event, 2026-09-18 20:33 UTC):

```
webhook_events:        external_object_id = '1287488901121523'
                       status              = 'PROCESSED'
external_interactions: interaction_type    = 'COMMENT'
                       external_id         = '122094187437489537_1582353133389249'
                       content             = 'This is the very first comment on Content Platform.'
worker log:            [webhook.process] event 87f0c082-... processed: 1 interactions
```

The `feed` field with `item: 'status'` (Page's own post creation) is
correctly skipped — `FeedChangeExtractor` only materializes `comment`,
`reaction`, and `mention`. Verified by:

```
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
| Ngrok URL (current)     | `https://uncanny-reappoint-unaligned.ngrok-free.dev` |

Database records created during Phase 18a E2E:

| Table                      | ID                                     |
| -------------------------- | -------------------------------------- |
| `destinations.id`          | `51eb5e79-b6a5-4f51-86bb-23dd81e9167e` |
| `webhook_subscriptions.id` | `2bc850b3-3e93-45d7-98cd-45e07a2daf00` |

**Security note:** the Meta App Secret and the ngrok authtoken appeared
in the development chat during setup. Rotate both before any external
collaboration:

- App Secret: `developers.facebook.com/apps/915404831335846/settings/basic/` → Reset
- Ngrok token: `dashboard.ngrok.com/get-started/your-authtoken` → Regenerate

The System User token is stored only in the browser session and is not
committed to the repository.

---

## Current state

### Workspace

Six workspace packages:

| Package                         | Purpose                                                               | Tests                      |
| ------------------------------- | --------------------------------------------------------------------- | -------------------------- |
| `packages/database`             | Drizzle schema, migrations, 13 repositories, TransactionManager       | 22 (skipped)               |
| `packages/authentication`       | AES-256-GCM, MetaCredentialService, Graph API client                  | 24 (13 skipped)            |
| `packages/interaction-response` | Policy engine, template renderer (pure, deterministic)                | 21                         |
| `packages/publishers`           | MetaInteractionAdapter, MetaResponseReconciler, NoopMetaRateLimiter   | 16                         |
| `apps/worker`                   | OutboxDispatcher, webhook.process, webhook.respond, reconcile workers | 38 (8 skipped)             |
| `apps/api`                      | Fastify webhook ingress (POST + GET)                                  | 4 (skipped)                |
| **Total**                       |                                                                       | **99 passed / 47 skipped** |

### Database schema

- **44 tables** implementing DB v1.2 (`DATABASE_SCHEMA_CONTRACT.md`)
- **14 migrations** (`0000` – `0013`), applied to Neon PostgreSQL
- `pgcrypto` extension registered in `0000`, never re-declared
- Partial index `publications(external_post_id) WHERE ... IS NOT NULL`
- Partial unique index `provider_credentials_unique` with `COALESCE`
- Deferred FK `external_interactions.publication_id` → `publications.id`

### Repositories implemented (13)

- `OutboxRepository` — with `FOR UPDATE SKIP LOCKED` two-step claim
- `WebhookSubscriptionsRepository`
- `WebhookSubscriptionHealthRepository`
- `WebhookEventsRepository` — idempotent insert via `ON CONFLICT DO NOTHING`
- `WebhookDeliveriesRepository`
- `ExternalInteractionsRepository` — monotonic upsert with `occurred_at`
- `ProviderCredentialsRepository` — with partial unique index
- `PublicationsRepository`
- `DestinationsRepository`
- `InteractionResponsesRepository` — includes `claimForResponding` and `findByDestinationAndExternalResponseId`
- `InteractionResponseAttemptsRepository`
- `InteractionModerationActionsRepository`
- `InteractionResponseReconciliationsRepository`

Integration tests exist for every repository that has a write path:
`OutboxRepository`, `WebhookEventsRepository`,
`ExternalInteractionsRepository`, `ProviderCredentialsRepository`.
They run when `TEST_DATABASE_URL` is set.

### Platform primitives

- `createDatabaseClient` — factory with health check and graceful shutdown
- `TransactionManager` — the `run(fn)` API
- `OutboxRepository.enqueue(tx, job)` — the transactional outbox entry point
- `OutboxDispatcher` — PG → BullMQ bridge with stale recovery + cleanup
- `BullMqJobQueue` — BullMQ `Queue` abstraction (`JobQueue` interface),
  **per-queue** `Queue` instances keyed by the logical queue name
- `BullMqJobConsumer` — BullMQ `Worker` abstraction (`JobConsumer` interface)
- `redisOptionsFromUrl` — URL → `RedisOptions` parser with TLS auto-detection
- `WebhookProcessService` — parse + materialize webhook events into interactions
- `ChangeExtractorRegistry` — field-specific extractors (`feed`, `mention`)
- `InteractionResponseService` — policy engine + template renderer + moderation gate + outbox enqueue
- `WebhookRespondService` — atomic claim + Graph API call + status transitions
- `WebhookRespondReconcileService` — pull reconciliation via parent comment replies
- `MetaInteractionAdapter` — Graph API POST with error classification
- `MetaResponseReconciler` — Graph API GET with body matching
- `MetaGraphBridge` — HTTP bridge for both POST and GET
- `MetaCredentialService` — store / rotate / invalidate / validate / healthCheck
- `MetaErrorMapper` — Graph API error categorization
- `CredentialEncryptionProvider` — AES-256-GCM with AAD binding and key rotation

### Webhook inbound pipeline — COMPLETE

The `GET /api/v1/webhooks/meta` handshake is also implemented:

1. `hub.mode` must be `subscribe`, `hub.verify_token` and `hub.challenge` required
2. Iterates all `webhook_subscriptions` rows where `provider = 'META' AND status = 'ACTIVE'`
3. For each row, decrypts `verify_token_encrypted` with `WEBHOOK_TOKEN_ENCRYPTION_KEY`
4. AAD: `META:${destination_id}`
5. Ciphertext format: `v1:base64(iv ‖ ciphertext ‖ tag)` — AES-256-GCM
6. On match: updates `last_verified_at`, returns `hub.challenge` as plain text
7. On mismatch: HTTP 403

### `apps/worker/src/index.ts` — what it starts

- `OutboxDispatcher` — the PG → BullMQ bridge (Phase 16)
- `WebhookProcessWorker` — the `webhook.process` queue consumer (Phase 17+18a)
- `WebhookRespondWorker` — the `webhook.respond` queue consumer (Phase 18b)
- `WebhookRespondReconcileWorker` — the `webhook.respond.reconcile` queue consumer (Phase 18b)
- Graceful shutdown on `SIGINT` / `SIGTERM` (workers → dispatcher → queue → db)

### `apps/api` — routes

| Method | Path                    | Purpose                                   |
| ------ | ----------------------- | ----------------------------------------- |
| GET    | `/health`               | Liveness                                  |
| GET    | `/ready`                | Readiness with DB health check            |
| POST   | `/api/v1/webhooks/meta` | Webhook ingress (signature + tx + outbox) |
| GET    | `/api/v1/webhooks/meta` | Meta `hub.challenge` handshake            |

### Cloud services

| Service       | Provider | Region       | URL scheme      |
| ------------- | -------- | ------------ | --------------- |
| PostgreSQL 16 | Neon     | eu-central-1 | `postgresql://` |
| Redis 7 (TLS) | Upstash  | eu-central-1 | `rediss://`     |

**No local Docker.** The development machine runs Windows 10 1607
(build 14393) with 4 GB RAM. Docker Desktop requires Win 10 22H2
(build 19045) and 8 GB RAM. Cloud services are the supported
development path. `docker-compose.yml` is retained in the repository
as a reference for future environments.

### Toolchain

- Node.js **22.20.0** (pinned in `.nvmrc`)
- pnpm **12.3.4** (pinned via `packageManager`)
- TypeScript **7.0.2** (pinned in `package.json` and `pnpm-workspace.yaml`)
- Drizzle ORM **0.45.2**, Drizzle Kit **0.31.10**
- BullMQ **5.34.0**, ioredis **5.4.2** (pinned in `pnpm-workspace.yaml`)
- Fastify **5.2.0**, Zod **3.24.1** (pinned in `apps/api/package.json`)
- Vitest **5.0.0**
- ESLint **10.10.0**, Prettier **3.9.6**

### Documentation

- `README.md` — project overview
- `HANDOFF.md` — this file
- `docs/README.md` — documentation index
- `docs/adr/` — Architecture Decision Records (index, template, 5 entries)
- `docs/architecture/README.md`
- `docs/architecture/system-overview.md`
- `docs/architecture/domain-model.md`
- `docs/architecture/data-model.md`
- `docs/conventions/` — commits, TypeScript, database, migrations
- `docs/operations/README.md`
- `docs/operations/local-development.md`

Top-level specification documents in the repository root:

- `TECHNICAL_SPECIFICATION.md` v0.9.0 — committed (`e1f95c4`)
- `DATABASE_SCHEMA_CONTRACT.md` v1.2 — committed (`c954ef3`)
- `LOGICAL_MODEL_SPECIFICATION.md` — **status unconfirmed**

---

## Pending items

### 1. Meta App Secret and ngrok authtoken rotation

Both appeared in the development chat. Rotate before any external
collaboration.

### 2. `LOGICAL_MODEL_SPECIFICATION.md`

Confirm presence in the repository root. The `README.md` links to it.

### 3. Ngrok URL is ephemeral

The free ngrok URL changes on every restart. Meta's Webhooks → Page
configuration and the Webhook fields test both use this URL. Each
restart requires updating the Callback URL in the Meta dashboard.

For long-running development, consider a paid ngrok plan with a static
domain, or deploy `apps/api` behind a public HTTPS endpoint.

### 4. Integration tests have never been executed

The following DB-backed integration test files are skipped when
`TEST_DATABASE_URL` is not set:

- `packages/database/src/repositories/outbox-repository.test.ts`
- `packages/database/src/repositories/webhook-events-repository.test.ts`
- `packages/database/src/repositories/external-interactions-repository.test.ts`
- `packages/database/src/repositories/provider-credentials-repository.test.ts`
- `packages/authentication/src/meta/meta-credential-service.test.ts`
- `apps/worker/src/webhook/webhook-process-service.test.ts`
- `apps/worker/src/outbox-dispatcher.test.ts`
- `apps/api/src/routes/webhooks/meta.test.ts`

Set `TEST_DATABASE_URL` in `.env` to enable the 47 skipped tests.

### 5. Temporary credential shortcut

The worker reads `META_PAGE_ACCESS_TOKEN` from the environment. This
bypasses `MetaCredentialService` (the DB-backed, encrypted credential
store). When unset, every response fails with `AUTHENTICATION_ERROR`.
The DB-backed wiring is a later phase.

### 6. Interaction response configuration

`apps/worker/src/index.ts` currently uses:

- `DEFAULT_INTERACTION_RESPONSE_CONFIG` — empty rule set (fail-closed,
  every comment defers to human moderation)
- `DEFAULT_TEMPLATES` — empty map

Real values must be loaded from `system_config` under
`interaction_response_rules` and `interaction_response_templates`.

### 7. `destinations.trust_level`

The destinations schema has no `trust_level` column. The worker uses
`DEFAULT_TRUST_LEVEL = 'MEDIUM'` as a constant. A dedicated column can
be added when the reputation subsystem defines the source.

---

## Next steps

### Option A — Phase 19: Meta publisher adapter

Implement `packages/publishers/src/meta/meta-publisher-adapter.ts`:

- `postToPage(input)` — POST /{page-id}/feed
- `reconcile(postId)` — GET /{post-id}
- Rate limiter integration

Requires:

- `PublicationService` (durable intent + attempts + reconciliation)
- `content.publish` worker
- `publication.reconcile` worker

### Option B — Integration tests + first live E2E

Set `TEST_DATABASE_URL` in `.env`, run `pnpm test` against Neon. The current suite has 99 passed and 47 DB-dependent tests skipped. Then re-run the E2E Meta test from Phase 18a to
verify the full inbound pipeline now also triggers the interaction
response service (with empty rule set → MODERATION_REQUIRED row).

### Option C — system_config-driven configuration

Load `interaction_response_rules` and `interaction_response_templates`
from `system_config` in the worker startup. Add a `ConfigService` cache
(short TTL, invalidated on `last_rotation_at` change).

### Option D — Moderation UI

Add moderation endpoints in `apps/api` for the
`MODERATION_REQUIRED` queue (`findModerationPending`) and moderation
actions (`interaction_moderation_actions`).

### Option E — Staging VPS deployment

Deploy `apps/api` + `apps/worker` to a staging VPS to remove the ngrok
dependency. This makes the Meta integration stable and lets future
phases be developed against a fixed webhook URL.

---

## Architectural invariants (must not be violated)

1. PostgreSQL is the authoritative system of record.
2. Redis/BullMQ is the asynchronous execution layer.
3. Every durable domain transition that produces a side effect enqueues
   through `outbox_jobs` in the same PostgreSQL transaction.
4. No direct BullMQ enqueue is permitted on a durable-write hot path.
5. The webhook ingress performs exactly one database transaction per
   HTTP request and no Redis call on the hot path.
6. Provider credentials are encrypted at rest with application-managed
   keys. No plaintext secret is persisted in any ordinary application
   table.
7. `outbox_jobs` has no foreign keys.
8. Reconciliation is mandatory for every state machine that has an
   external side effect.
9. The system fails closed when mandatory validation cannot be completed.

---

## Known patterns and traps

These are lessons learned during Phases 14–18b. They are captured here so
that the next session does not re-encounter them.

### `RETURNING *` in raw SQL returns snake_case

Every raw SQL query with `RETURNING *` returns snake_case column names,
which do **not** match the Drizzle `$inferSelect` type. Two correct
patterns:

1. `RETURNING id` in raw SQL, then a Drizzle `SELECT` for the full row.
   Used by `OutboxRepository.claimPendingBatch` and
   `ProviderCredentialsRepository.upsert`.
2. Explicit `RETURNING id AS "id", col AS "camelCase"` aliases. Used by
   `ExternalInteractionsRepository.upsertMonotonic`.

Never cast a `RETURNING *` result to a camelCase type. This bug appeared
three times (external-interactions, provider-credentials, outbox-claim)
before the two-pattern convention was established.

### `ioredis` URL constructor overload

`ioredis` 5.x does not accept `(url: string, options)`. URLs must be
parsed into `RedisOptions` via `redisOptionsFromUrl`. The parser also
detects Upstash (`*.upstash.io`) hostnames and enables TLS
automatically, because Upstash's `redis-cli` copy-paste format uses
`redis://` even when TLS is required. The `rediss://` scheme also
enables TLS. The parser additionally forces `family: 4` (Windows
dual-stack can try IPv6 first, which Upstash rejects) and sets
`servername` for SNI.

### Vitest aliases

Each package's `vitest.config.ts` aliases `@content-platform/database`
to `packages/database/src/index.ts`. This ensures tests always run
against the latest source, not a stale `dist/`. Without the alias,
edits to a database repository are not visible to the worker tests
until `pnpm build` is run.

### `pnpm postinstall` vs `prepare`

- `postinstall`: `pnpm -r --if-present run build` — runs on fresh
  installs, new dependencies, lockfile changes.
- `prepare`: `husky || true` — runs on root `pnpm install`.

`rm -rf dist && pnpm install` does **not** trigger `postinstall`,
because the dependency graph is unchanged. Use `pnpm build` to rebuild
manually. This is a pnpm 10+ optimization, not a bug.

### Vitest `fileParallelism: false`

Integration tests share a single PostgreSQL database and a single
Redis instance. Running test files in parallel causes one file's
`TRUNCATE ... CASCADE` to wipe another file's in-flight rows. Every
workspace package's `vitest.config.ts` sets `fileParallelism: false`.

### pnpm `-r` runs packages in parallel — use `--workspace-concurrency=1`

Even with `fileParallelism: false` inside each package, `pnpm -r` still
runs the _packages_ themselves in parallel. For tests that share a
single PostgreSQL database (like this project), the root `test` script
must be:

```
"test": "pnpm -r --workspace-concurrency=1 --if-present run test"
```

Without `--workspace-concurrency=1`, the `apps/api` and
`packages/database` tests interfere via `TRUNCATE` on `webhook_events`
and `outbox_jobs`.

### `__dirname` in vitest configs

Vite's upcoming native config loader does not support `__dirname`. Use
`import.meta.dirname` instead. This is a warning today and will be a
hard error in a future Vitest release.

### Fastify raw body for HMAC verification

Fastify parses `application/json` into an object by default, losing the
raw bytes needed for HMAC-SHA256 signature verification. The fix is a
custom content-type parser:

```typescript
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
  request.rawBody = body as Buffer;
  try {
    done(null, JSON.parse((body as Buffer).toString('utf8')));
  } catch (err) {
    done(err as Error, undefined);
  }
});
```

The `rawBody` is attached to the request via a `declare module 'fastify'`
augmentation. Do not attempt to reconstruct the raw bytes from the parsed
object — the signature will not match.

### `exactOptionalPropertyTypes` and conditional spread

With `exactOptionalPropertyTypes: true` (set in `tsconfig.base.json`),
`field: undefined` is not assignable to `field?: string`. Use conditional
spread to omit the property entirely:

```typescript
await tx.insert(webhookEvents).values({
  provider: 'META',
  objectType: envelope.object,
  // ... required fields ...
  ...(field !== undefined && { field }),
});
```

This pattern is used in `apps/api/src/routes/webhooks/meta.ts` and in
several database repositories.

### `pnpm build` must precede `pnpm typecheck` when a referenced package changes

The TypeScript project references read the referenced package's
`dist/*.d.ts`. If a new method is added to `packages/database` and the
`dist/` is stale, `pnpm typecheck` fails with "Property X does not exist
on type Y". Always run `pnpm build` first.

### pnpm 12 does not relink `.bin` when a new workspace package is added

Adding `packages/publishers/package.json` (or any other new package)
triggers `pnpm install`, but the `.bin/vitest` symlink inside the new
package's `node_modules` is not created. The fix is `pnpm dedupe`,
which forces the full link pass.

### `InteractionResponseServiceDeps` must include `outboxRepo`

The service enqueues a `webhook.respond` outbox job in the same
transaction as the response insert. The dependency must be present in
the interface, and every test/fake must supply it.

### Push-reconciliation: `continue` after actor-match

In `WebhookProcessService`, when an interaction's `actorExternalId`
equals the destination's `externalId`, this is the platform's own
outbound reply coming back. **Never** run the policy decision for these
interactions, whether or not a matching response record exists. Use
`continue` to skip the rest of the inner loop body.

### Meta Test button sends dummy Page ID

The Meta dashboard "Test" button sends `entry[0].id = "0"`, not the
real Page ID. In Development mode this is the only webhook source. The
ingress resolves destination from `entry[0].id`, so `"0"` never matches,
and the event ends up `FAILED` with `UNKNOWN_DESTINATION`. To test the
real path, the app must be in **Live mode** and events must come from
real user actions.

### Meta App must be in Live mode

Development mode does not deliver real webhook events from any source,
including app admins, developers, or testers. The Meta dashboard states
this explicitly. To receive real events:

1. Provide `Privacy Policy URL` — a public GitHub Gist works. Example:
   create a public Gist with the Privacy Policy Markdown, then paste the
   Gist URL into App Settings → Basic → Privacy Policy URL.
2. Provide `App Icon` — 1024×1024 PNG with transparent background.
   A PowerShell script that generates one is possible with
   `System.Drawing.Bitmap` + `Format32bppArgb` + `Graphics.Clear(Transparent)`.
3. Provide `Category` — e.g., `News and Media` or `Business and Pages`.
4. Switch App Mode to **Live** via the Dashboard toggle.

### Meta Business Suite System User

For stable Page access independent of a personal Facebook account, use
a **System User**:

1. Business Suite → Settings → Users → System Users → Add.
2. Role: Admin.
3. On the System User details page, use **Assign Assets** to attach:
   - **Pages** → target Page → Full Control
   - **Apps** → Meta App → Full Control
4. Generate token: App = Meta App, duration = 60 days, permissions
   include `pages_manage_metadata`, `pages_read_engagement`,
   `pages_show_list`.
5. Use the resulting token directly in Graph API Explorer's **Access
   Token** field. Do not use the "User or Page" dropdown — the System
   User does not appear there.

The System User pages in Business Suite are sometimes navigated by
`?business_id=...&selected_user_id=...` URLs. If the URL does not load
the correct page, use the left sidebar navigation instead:
**Rendszerfelhasználók** → click the user's name.

### `subscribed_apps` — GET vs POST

- `GET /{page-id}/subscribed_apps` — lists apps the Page is subscribed to.
- `POST /{page-id}/subscribed_apps?subscribed_fields=feed,mention` —
  subscribes the App to the Page's fields. Returns `{"success": true}`.

The Graph API Explorer's URL for POST is constructed as:

```
https://developers.facebook.com/tools/explorer/?method=POST&path=1287488901121523%2Fsubscribed_apps&version=v26.0&subscribed_fields=feed%2Cmention
```

Setting the method to POST and clearing the URL query is often faster
than using the UI dropdowns.

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
