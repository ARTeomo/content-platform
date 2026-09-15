# Handoff — Project State

This document records the project state at a milestone boundary. It is
intended to be read first when resuming work in a new session.

**Snapshot date:** 2026-09-15
**Last commit:** e5d42b0 (chore: ignore local bootstrap script)
**Repository:** https://github.com/ARTeomo/content-platform

---

## Current state

### Database schema

- **44 tables** implementing DB v1.2 (`DATABASE_SCHEMA_CONTRACT.md`)
- **14 migrations** (`0000` – `0013`), clean baseline
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

Integration tests exist for `OutboxRepository`, `WebhookEventsRepository`,
and `ExternalInteractionsRepository`. They run only when `TEST_DATABASE_URL`
is set.

### Platform primitives

- `createDatabaseClient` — factory with health check and graceful shutdown
- `TransactionManager` — the `run(fn)` API
- `OutboxRepository.enqueue(tx, job)` — the transactional outbox entry point

### Toolchain

- Node.js **22.20.0** (pinned in `.nvmrc`)
- pnpm **12.3.4** (pinned via `packageManager`)
- TypeScript **7.0.2** (pinned in `package.json` and `pnpm-workspace.yaml`)
- Drizzle ORM **0.45.2**, Drizzle Kit **0.31.10**
- Vitest **5.0.0**
- ESLint **10.10.0**, Prettier **3.9.6**

### Documentation

- `README.md` — project overview
- `docs/README.md` — documentation index
- `docs/architecture/README.md`
- `docs/architecture/system-overview.md`
- `docs/architecture/domain-model.md`
- `docs/architecture/data-model.md`
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
package. Each one deserves its own commit.

### 2. `.gitignore` references a deleted file

The file `.gitignore` contains a line `bootstrap-docs.sh`, but the file
itself was deleted. The entry is harmless (it prevents future accidental
commits). It can be left as-is or removed.

### 3. Integration tests have never been executed

The three test files (`outbox-repository.test.ts`,
`webhook-events-repository.test.ts`,
`external-interactions-repository.test.ts`) are skipped when
`TEST_DATABASE_URL` is not set. They have never run against a real
PostgreSQL instance.

---

## Next steps

### Phase 14 — Local development environment

1. Create `docker-compose.yml` with:
   - `postgres:16-alpine` on port `5432`
   - `redis:7-alpine` on port `6379`
2. Create `.env` from `.env.example` with local values.
3. Run `pnpm db:migrate` to apply the 14 migrations.
4. Run `pnpm test` with `TEST_DATABASE_URL` to execute the integration tests.
5. Create the `content_platform_test` database for tests.

### Phase 15 — Credential lifecycle

Implement `packages/authentication/`:

- `CredentialEncryptionProvider` — AES-256-GCM with AAD binding
- `MetaCredentialService` — get/store/rotate/invalidate/validate
- `MetaErrorMapper` — Graph API error categorization

### Phase 16 — Outbox dispatcher

Implement `apps/worker/src/outbox-dispatcher.ts`:

- `claimPendingBatch` via `FOR UPDATE SKIP LOCKED`
- Dispatch to BullMQ with `jobId` deduplication
- Recovery of stale `DISPATCHING` rows
- Cleanup of `DISPATCHED` rows older than retention

### Phase 17 — Webhook ingress

Implement `apps/api/src/routes/webhooks/meta.ts`:

- HMAC-SHA256 signature verification (fail-closed → 401)
- Zod envelope validation (fail-closed → 400)
- Single transaction: insert `webhook_events` + `outbox_jobs`
- HTTP 200 OK

### Phase 18 — webhook.process worker

Implement `apps/worker/src/webhook-process.ts`:

- Load event, guard status
- Parse payload, iterate entries and changes
- Materialize `external_interactions` with monotonic upsert
- Update event status and delivery history

### Phase 19 — Meta publisher adapter

Implement `packages/publishers/meta/`:

- `MetaPublisherAdapter`
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

## Source-of-truth hierarchy

```text
1. Domain and architecture contracts
2. DB v1 Logical Model Specification
3. DATABASE_SCHEMA_CONTRACT.md
4. Drizzle schema implementation
5. Generated PostgreSQL migrations
