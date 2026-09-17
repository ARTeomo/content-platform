# Handoff — Project State

This document records the project state at a milestone boundary. It is
intended to be read first when resuming work in a new session.

**Snapshot date:** 2026-09-17
**Last commit:** `eba1ddb` (chore(api): apply prettier formatting)
**Repository:** https://github.com/ARTeomo/content-platform

---

## Current state

### Workspace

Five workspace packages:

| Package                   | Purpose                                                        | Tests  |
| ------------------------- | -------------------------------------------------------------- | ------ |
| `packages/database`       | Drizzle schema, migrations, 8 repositories, TransactionManager | 22     |
| `packages/authentication` | AES-256-GCM, MetaCredentialService, Graph API client           | 37     |
| `apps/worker`             | OutboxDispatcher, webhook.process service + extractors         | 8      |
| `apps/api`                | Fastify webhook ingress (POST + GET)                           | 4      |
| **Total**                 |                                                                | **71** |

### Database schema

- **44 tables** implementing DB v1.2 (`DATABASE_SCHEMA_CONTRACT.md`)
- **14 migrations** (`0000` – `0013`), applied to Neon PostgreSQL
- `pgcrypto` extension registered in `0000`, never re-declared
- Partial index `publications(external_post_id) WHERE ... IS NOT NULL`
- Partial unique index `provider_credentials_unique` with `COALESCE`
- Deferred FK `external_interactions.publication_id` → `publications.id`

### Repositories implemented (8)

- `OutboxRepository` — with `FOR UPDATE SKIP LOCKED` two-step claim
- `WebhookSubscriptionsRepository`
- `WebhookSubscriptionHealthRepository`
- `WebhookEventsRepository` — idempotent insert via `ON CONFLICT DO NOTHING`
- `WebhookDeliveriesRepository`
- `ExternalInteractionsRepository` — monotonic upsert with `occurred_at`
- `ProviderCredentialsRepository` — with partial unique index
- `PublicationsRepository`

Integration tests exist for every repository that has a write path:
`OutboxRepository`, `WebhookEventsRepository`,
`ExternalInteractionsRepository`, `ProviderCredentialsRepository`.
They run when `TEST_DATABASE_URL` is set. The full suite is **71/71**
green against Neon PostgreSQL + Upstash Redis.

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
- `MetaCredentialService` — store / rotate / invalidate / validate / healthCheck
- `MetaErrorMapper` — Graph API error categorization
- `CredentialEncryptionProvider` — AES-256-GCM with AAD binding and key rotation

### Webhook inbound pipeline — COMPLETE

```
Meta POST (HTTPS)
  → apps/api  POST /api/v1/webhooks/meta
      1. Raw body buffer (Fastify addContentTypeParser, parseAs: 'buffer')
      2. HMAC-SHA256 signature verify (fail-closed → 401)
      3. Zod envelope validate (fail-closed → 400)
      4. Single PostgreSQL transaction:
           INSERT webhook_events (ON CONFLICT DO NOTHING RETURNING id, trace_id)
           IF a row was inserted:
             INSERT outbox_jobs (queue_name = 'webhook.process',
                                 job_id = 'webhook.process:' || event.id)
      5. HTTP 200 OK
  → OutboxDispatcher (FOR UPDATE SKIP LOCKED claim)
  → BullMQ webhook.process queue
  → WebhookProcessWorker
  → WebhookProcessService
  → external_interactions (monotonic upsert on occurred_at)
```

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
- Graceful shutdown on `SIGINT` / `SIGTERM` (worker → dispatcher → queue → db)

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
(build 19045) and 8 GB RAM, so the local Docker workflow is not
available. Cloud services match the production topology and are the
supported development path. `docker-compose.yml` is retained in the
repository as a reference for future environments.

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

### 1. Meta sandbox E2E test — prepared, blocked

The Meta Business Suite portfolio **Content Platform** has been created
(registered under the user's own name). The next step — adding objects to
the portfolio — was reached but not completed. A Facebook Page is
required for the test.

The Meta App itself has **not** been created yet on
`developers.facebook.com`.

The `webhook_subscriptions` table has no row for the test destination
yet, so the `GET` handshake will find nothing to compare against. A
one-shot script is required to:

1. Insert a `destinations` row for the test Page (Page ID from the Meta Page).
2. Insert a `webhook_subscriptions` row with the encrypted verify token
   (format `v1:base64(iv ‖ ciphertext ‖ tag)`, AAD `META:${destination_id}`).

### 2. Phase 18b — `webhook.respond`

Not started. The largest single phase so far (estimated 4000–4500 lines
across repositories, services, workers, and tests). Requires:

- 4 new repositories (responses, attempts, moderation, reconciliations)
- Policy engine, template renderer, moderation gate
- `MetaInteractionAdapter` (Graph API comment reply)
- 2 new queues (`webhook.respond`, `webhook.respond.reconcile`)
- Push-reconciliation hook in the existing `WebhookProcessService`

### 3. `LOGICAL_MODEL_SPECIFICATION.md`

The `README.md` and `docs/README.md` link to it at the repository root.
If it is not present, the link returns 404. Verify its presence before
continuing.

---

## Next steps — Meta sandbox E2E

1. **Add a Facebook Page to the Meta Business Suite portfolio.**
   - Use "Content Platform" as the Page name (or add an existing Page).
   - Record: **Page ID** (this becomes `destinations.external_id`) and
     the Page name (this becomes `destinations.name`).
   - Skip Instagram, Pixel, and Data Sources for now.

2. **Create a Meta App** on `developers.facebook.com/apps`.
   - Type: **Business**.
   - Name: `content-platform-dev`.
   - Mode: **Development** (no App Review needed).
   - Record: **App ID** (not secret) and **App Secret** (Show → copy).
   - Add Product → **Webhooks** → Set Up.

3. **Install and start ngrok.**
   - `ngrok config add-authtoken <token>`
   - `ngrok http 3000`
   - Record the HTTPS forwarding URL: `https://<id>.ngrok-free.app`.

4. **Configure `.env`** with the following values:
   - `META_APP_ID=<app-id>`
   - `META_APP_SECRET=<app-secret>`
   - `WEBHOOK_TOKEN_ENCRYPTION_KEY=<base64-32-bytes>` (`openssl rand -base64 32`)
   - `PORT=3000`, `HOST=0.0.0.0`

5. **Insert a `destinations` + `webhook_subscriptions` row** for the test
   Page (a small script to be written in the next session).

6. **Start the API** (`pnpm --filter @content-platform/api start`) and the
   **worker** (`pnpm --filter @content-platform/worker start`) in separate
   terminals.

7. **Verify in the Meta dashboard** — Webhooks → Page:
   - Callback URL: `https://<ngrok>.ngrok-free.app/api/v1/webhooks/meta`
   - Verify Token: the same value that was encrypted in step 5.
   - Click **Verify and Save**.

8. **Subscribe to the `feed` field** and send a test event (Meta Test
   button, or a real comment on the Page).

9. **Verify the DB:**
   - `webhook_events` — one row, status `RECEIVED` → `PROCESSING` → `PROCESSED`
   - `outbox_jobs` — one row, status `DISPATCHED`
   - `external_interactions` — one row with the comment/reaction/mention

Estimated time: **2–4 hours** across all 9 steps, with 2–3 iterations
expected on the handshake (steps 7–8 are where most issues surface).

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

These are lessons learned during Phases 14–18a. They are captured here so
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
