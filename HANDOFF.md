# Handoff — Project State

This document records the project state at a milestone boundary. It is
intended to be read first when resuming work in a new session.

**Snapshot date:** 2026-09-16
**Last commit:** `db62dc5` (test(worker): add webhook process service integration test)
**Repository:** https://github.com/ARTeomo/content-platform

---

## Current state

### Workspace

Four workspace packages:

| Package                   | Purpose                                                        | Tests  |
| ------------------------- | -------------------------------------------------------------- | ------ |
| `packages/database`       | Drizzle schema, migrations, 8 repositories, TransactionManager | 22     |
| `packages/authentication` | AES-256-GCM, MetaCredentialService, Graph API client           | 37     |
| `apps/worker`             | OutboxDispatcher, webhook.process service + extractors         | 8      |
| **Total**                 |                                                                | **67** |

### Database schema

- **44 tables** implementing DB v1.2 (`DATABASE_SCHEMA_CONTRACT.md`)
- **14 migrations** (`0000` – `0013`), applied to Neon PostgreSQL
- `pgcrypto` extension registered in `0000`, never re-declared
- Partial index `publications(external_post_id) WHERE ... IS NOT NULL`
- Partial unique index `provider_credentials_unique` with `COALESCE`
- Deferred FK `external_interactions.publication_id` → `publications.id`

### Repositories implemented

- `OutboxRepository`
- `WebhookSubscriptionsRepository`
- `WebhookSubscriptionHealthRepository`
- `WebhookEventsRepository`
- `WebhookDeliveriesRepository`
- `ExternalInteractionsRepository`
- `ProviderCredentialsRepository`
- `PublicationsRepository`

Integration tests exist for every repository that has a write path:
`OutboxRepository`, `WebhookEventsRepository`,
`ExternalInteractionsRepository`, `ProviderCredentialsRepository`.
They run when `TEST_DATABASE_URL` is set. The full suite is **67/67**
green against Neon PostgreSQL + Upstash Redis.

### Platform primitives

- `createDatabaseClient` — factory with health check and graceful shutdown
- `TransactionManager` — the `run(fn)` API
- `OutboxRepository.enqueue(tx, job)` — the transactional outbox entry point
- `OutboxDispatcher` — PG → BullMQ bridge with stale recovery + cleanup
- `BullMqJobQueue` — BullMQ `Queue` abstraction (`JobQueue` interface)
- `BullMqJobConsumer` — BullMQ `Worker` abstraction (`JobConsumer` interface)
- `redisOptionsFromUrl` — URL → `RedisOptions` parser with TLS auto-detection
- `WebhookProcessService` — parse + materialize webhook events into interactions
- `ChangeExtractorRegistry` — field-specific extractors (`feed`, `mention`)
- `MetaCredentialService` — store / rotate / invalidate / validate / healthCheck
- `MetaErrorMapper` — Graph API error categorization
- `CredentialEncryptionProvider` — AES-256-GCM with AAD binding and key rotation

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

---

## Pending items

### 1. Three top-level specification documents are missing

The `README.md` and `docs/README.md` link to these files, but they are not
yet in the repository:

- `TECHNICAL_SPECIFICATION.md`
- `LOGICAL_MODEL_SPECIFICATION.md`
- `DATABASE_SCHEMA_CONTRACT.md` (v1.2)

They must be copied into the repository root from the architecture
package. Each one deserves its own commit. They are large (1000+ lines
each), so they are the largest pending item.

### 2. Three ADR files are missing

`docs/adr/README.md` indexes five ADRs, but only two exist as files:

- `ADR-001-postgres-js.md` — missing (index entry exists)
- `ADR-002-outbox-pattern.md` — missing (index entry exists)
- `ADR-005-health-separation.md` — missing (index entry exists)
- `ADR-003-uuid-primary-keys.md` — present
- `ADR-004-no-db-triggers.md` — present

### 3. `.gitignore` references a deleted file

The file `.gitignore` contains a line `bootstrap-docs.sh`, but the file
itself was deleted. The entry is harmless (it prevents future accidental
commits). It can be left as-is or removed.

### 4. `docker-compose.yml` is unused on this machine

The file exists in the repository as a reference. It is not used by the
current development workflow (Windows 10 1607, 4 GB RAM cannot run
Docker Desktop). It will be relevant in environments that support Docker.

---

## Next steps

### Phase 18a — Webhook ingress (`apps/api`)

Create `POST /api/v1/webhooks/meta`:

1. HMAC-SHA256 signature verification (`X-Hub-Signature-256`), fail-closed → 401
2. Zod envelope validation, fail-closed → 400
3. `hub.challenge` GET handshake for Meta subscription verification
4. Single transaction: `webhook_events` + `outbox_jobs`
5. HTTP 200 OK

This closes the inbound chain:

```
Meta POST → signature verify → outbox_jobs → BullMQ
  → webhook.process → external_interactions
```

After this phase, the inbound integration is end-to-end testable with a
single `curl` command.

### Phase 18b — `webhook.respond` worker

The outbound response lifecycle:

- `InteractionResponseService` (policy decision, template render)
- `MetaInteractionAdapter` (Graph API call)
- `webhook.respond` BullMQ consumer
- Push-reconciliation via the `feed` webhook

### Phase 19 — Meta publisher adapter

- `MetaPublisherAdapter` with Graph API integration
- `MetaRateLimiter`
- `MetaPublicationReconciler`

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

These are lessons learned during Phases 14–17. They are captured here so
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

### `__dirname` in vitest configs

Vite's upcoming native config loader does not support `__dirname`. Use
`import.meta.dirname` instead. This is a warning today and will be a
hard error in a future Vitest release.

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
