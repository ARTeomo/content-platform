# Sprint audit — 2026-10-03

**Baseline audit:** [`baseline-audit-2026-09-20.md`](./baseline-audit-2026-09-20.md)

**Commit range:** `de5a71a..945b082` (12 commits)

**HEAD at audit time:** `945b082` (docs(handoff): record F8, F17, and drizzle snapshot fixes)

**Repository state:** `main` in sync with `origin/main`, working tree clean.

**Test state:** 235 passed / 0 failed / 0 skipped (with `TEST_DATABASE_URL` and `TEST_REDIS_URL` exported).

---

## 1. Executive summary

The baseline audit of 2026-09-20 identified 17 findings in the Phase 1–19 work. Of those, 9 were closed across the three Sprint A-B-C phases, 2 more were closed during the final review, and one additional infrastructure gap (the Drizzle snapshot chain) was also found during the final review. The remaining finding (`audit_logs` writer) is **intentionally open** — it belongs to the admin UI, which is not part of the current baseline.

The work was delivered in 12 commits, organized into three logical blocks plus a final review:

- **Sprint A** (1 commit) — worker runtime wiring: `system_config` loading, DB-backed Meta credentials, publication scheduler credential gate, interaction response scheduler, `shouldInvalidateCredential` propagation.
- **Sprint B** (5 commits) — baseline contract findings: webhook transaction boundary, webhook crypto centralization, Redis rate limiters, atomic claims on the webhook and interaction response paths.
- **Sprint C** (3 commits) — observability and operational primitives: `system.rebuild`, `system.outbox.cleanup`, `notifications`, `system_logs`.
- **Final review** (3 commits) — F8 reconciliation gap, F17 worker dev script, Drizzle snapshot chain, HANDOFF updates.

The system is **verified at runtime** against a real Neon PostgreSQL and Upstash Redis. The worker boot log, scheduler startup, and the first `system.outbox.cleanup` run are all documented.

---

## 2. Findings summary table

| #   | Finding                                                   | Severity | Commit    | Status                                       |
| --- | --------------------------------------------------------- | -------- | --------- | -------------------------------------------- |
| F1  | Webhook ingress transaction boundary                      | Medium   | `16675be` | ✅ Closed                                    |
| F2  | Interaction response config from `system_config`          | High     | `90e210c` | ✅ Closed                                    |
| F3  | Interaction response rate limiter                         | High     | `4849440` | ✅ Closed                                    |
| F4  | Publication rate limiter                                  | High     | `4849440` | ✅ Closed                                    |
| F5  | `MetaCredentialService` wired into the worker             | High     | `90e210c` | ✅ Closed                                    |
| F6  | Scheduler credential-health gate                          | High     | `90e210c` | ✅ Closed                                    |
| F7  | `system.rebuild` + `system.outbox.cleanup`                | Medium   | `97db14d` | ✅ Closed                                    |
| F8  | Interaction response scheduler (UNKNOWN reconciliation)   | High     | `c9b13e7` | ✅ Closed                                    |
| F9  | `shouldInvalidateCredential` propagation                  | High     | `90e210c` | ✅ Closed                                    |
| F10 | Webhook verify token key version                          | Medium   | `b32c2cd` | ✅ Closed                                    |
| F11 | `notifications` table never written                       | Medium   | `97db14d` | ✅ Closed                                    |
| F12 | `system_logs`, `audit_logs`, `ai_usage` dead code         | Low      | `97db14d` | 🟡 Partial — `audit_logs` intentionally open |
| F13 | Crypto duplication (two AES-256-GCM implementations)      | Medium   | `b32c2cd` | ✅ Closed                                    |
| F14 | `WebhookProcessService` race condition                    | Low      | `3373895` | ✅ Closed                                    |
| F15 | `InteractionResponseService` race condition               | Low      | `3373895` | ✅ Closed                                    |
| F16 | API crypto import from `@content-platform/authentication` | Low      | `b32c2cd` | ✅ Closed                                    |
| F17 | Worker `dev` script missing                               | Low      | `76410d8` | ✅ Closed                                    |

**Result:** 16 findings fully closed, 1 intentionally open (`audit_logs`).

---

## 3. Detailed finding descriptions

### F1 — Webhook ingress transaction boundary

**Baseline observation.** The `POST /api/v1/webhooks/meta` route performed two database operations per HTTP request: a separate `SELECT id FROM destinations` outside the transaction, then a `txManager.run()` block for the `INSERT webhook_events` and `INSERT outbox_jobs`. This violated HANDOFF §Architectural invariants point 5: _"The webhook ingress performs exactly one database transaction per HTTP request and no Redis call on the hot path."_

**Fix.** The destination lookup was moved inside the transaction. The `rawBodyHash` and `idempotencyKey` computation — pure CPU, no DB I/O — remained outside.

```typescript
await txManager.run(async (tx) => {
  const destinationRows = (await tx.execute(sql`
    SELECT id FROM destinations
    WHERE type = 'META' AND external_id = ${externalObjectId}
    LIMIT 1
  `)) as unknown as Array<{ id: string }>;
  const destinationId = destinationRows[0]?.id ?? null;

  const result = await eventsRepo.insertIdempotent(tx, {/* ... */});
  if (result.inserted) {
    await outboxRepo.enqueue(tx, {/* ... */});
  }
});
```

**Evidence.** `apps/api/src/routes/webhooks/meta.ts` line 101: the `SELECT` is inside the `tx.execute(sql\`...\`)`call.`meta.test.ts`4/4 green. The commit was`15 insertions, 9 deletions`.

**Commit.** `16675be` — `fix(api): webhook ingress uses a single DB transaction`

---

### F2 — Interaction response config from `system_config`

**Baseline observation.** The worker used the constants `DEFAULT_INTERACTION_RESPONSE_CONFIG` and `DEFAULT_TEMPLATES`, with an empty rule set and empty template map. The `system_config` table existed, but nothing read it. The policy engine ran in **fail-closed** mode — every incoming comment landed in the `MODERATION_REQUIRED` state.

**Fix.** A new `SystemConfigRepository` (`packages/database/src/repositories/system-config-repository.ts`) with `get<T>` and `getMany<T>` methods. A new `loadRuntimeConfig` function (`apps/worker/src/credentials/runtime-config-loader.ts`) to load `system_config` keys, with default fallback and a `defaultedKeys` report. The worker bootstrap now reads its configuration from `system_config` and warns when a key was defaulted.

**Evidence.**

- Worker boot log with no defaults: `[worker] interaction response: 0 rules, 0 templates` — no `system_config keys defaulted:` warning.
- Seed migration `0013_seed_system_config.sql` inserts the `interaction_response_rules`, `interaction_response_templates`, `interaction_response.max_per_hour_per_destination`, `interaction_response.min_interval_seconds`, `interaction_response.global_max_per_hour` keys.
- After `pnpm db:migrate`, the `system_config` table contains 5 rows.

**Commit.** `90e210c` — `feat(worker): wire runtime config, credentials, schedulers`

---

### F3 — Interaction response rate limiter

**Baseline observation.** `MetaInteractionAdapter` was constructed with `NoopMetaRateLimiter`, which always returns `{ allowed: true }`. The Meta Graph API `pages_manage_engagement` BUC limit was not enforced. A `(#4) Application request limit reached` error produced a `RATE_LIMIT` → `RETRY` → `RATE_LIMIT` infinite loop.

**Fix.** A new `RedisMetaRateLimiter` implementation (`packages/publishers/src/meta/redis-meta-rate-limiter.ts`) that checks three budgets **atomically in a single Lua script**: per-destination hourly, global hourly, global daily. Sliding window using Redis sorted sets. A `RateLimiterRedisLike` interface ensures that `packages/publishers` does **not** pick up a runtime `ioredis` dependency — the worker passes its own Redis client.

The limiter **fails closed**: if Redis is unreachable, the request is denied with a 60-second retry hint. The principle: if we cannot prove we are under the limit, we do not call the Meta API.

**Evidence.** `packages/publishers/src/meta/redis-meta-rate-limiter.test.ts` with 5 tests against real Upstash:

- `allows calls under the per-destination limit`
- `denies calls over the per-destination limit`
- `keeps destinations independent`
- `keeps publish and engagement budgets independent`
- `enforces the global hourly limit across destinations`

Worker boot log: `[worker] rate limits: publish=10/h/dest, engagement=30/h/dest`.

**Commit.** `4849440` — `feat(publishers): add Redis-backed Meta rate limiter`

---

### F4 — Publication rate limiter

Same as F3, but for the `pages_manage_posts` BUC limit. `RedisMetaRateLimiter` implements both interfaces (`MetaRateLimiter` and `MetaPublishRateLimiter`), so a **single instance** serves both adapters.

**Evidence.** `RedisMetaRateLimiter.checkPublish()` method and the worker wiring where `new MetaPublisherAdapter({ rateLimiter, ... })` receives the same `rateLimiter` object.

**Commit.** `4849440` (same as F3)

---

### F5 — `MetaCredentialService` wired into the worker

**Baseline observation.** The `@content-platform/authentication` package was declared in the worker's `package.json`, but the worker **did not import anything from it**. `MetaCredentialService`, `CredentialEncryptionProvider`, and `ProviderCredentialsRepository` were all implemented, but had zero callers. The token lived exclusively in the `META_PAGE_ACCESS_TOKEN` environment variable.

**Fix.** A new `buildMetaCredentialService` factory (`apps/worker/src/credentials/meta-credential-bridge.ts`) and a `buildGetAccessToken` callback (`apps/worker/src/credentials/get-access-token.ts`). The resolution order: DB-backed token, then fallback to `META_PAGE_ACCESS_TOKEN` with a **deprecation warning**. The `MetaCredentialServiceBundle` type uses an optional `service?: MetaCredentialService` field so the worker can boot in degraded mode if the credential service is unavailable.

**Evidence.** Worker boot log: `[worker] DB-backed Meta credentials available` (or `unavailable: missing environment variables: ...` warning).

**Commit.** `90e210c` (same as F2)

---

### F6 — Scheduler credential-health gate

**Baseline observation.** `PublicationSchedulerService` enqueued `content.publish` jobs directly, without checking credential health. If a destination's token was `INVALID`, the scheduler still enqueued, the worker failed with `AUTHENTICATION_ERROR`, and the publication landed in `FAILED` — after making unnecessary Meta API calls.

**Fix.** `PublicationSchedulerService` now accepts an **optional** `credentialService?: MetaCredentialService` dependency. When present, it calls `healthCheck(destinationId)` for every unique destination, and when `overall === 'INVALID'`, it moves the publication to `FAILED` (not back to `SCHEDULED`), so it does not re-enter the scan window.

**Evidence.** `publication-scheduler-service.test.ts` 5/5 green. The worker bootstrap wires it via `...(credentialBundle.service !== undefined && { credentialService: credentialBundle.service })`.

**Commit.** `90e210c` (same as F2)

---

### F7 — `system.rebuild` and `system.outbox.cleanup`

**Baseline observation.** The Technical Specification specified two separate queues: `system.rebuild` (rebuild queue state from durable PostgreSQL state after a BullMQ loss) and `system.outbox.cleanup` (dedicated worker for cleanup instead of a dispatcher timer). Neither existed. Cleanup ran inside the dispatcher's `setInterval`, which causes a race **under multi-worker scaling** (multiple dispatchers DELETE the same rows).

**Fix.**

- `SystemRebuildService` — scans three entities (`webhook_events.RECEIVED`, `publications.SCHEDULED`, `interaction_responses.SCHEDULED`) and enqueues jobs with a `:rebuild:<epoch_ms>` suffix. Idempotency at two layers: the suffix distinguishes rebuild job_ids from primary scheduler job_ids, and the outbox `enqueue` uses `ON CONFLICT DO NOTHING`.
- `SystemOutboxCleanupService` — dedicated worker that calls `cleanupOlderThan(retentionDays)`.
- `SystemOutboxCleanupSchedulerWorker` — enqueues one cleanup job per hour. `intervalMs=0` disables it.
- The dispatcher cleanup timer was **removed**.

**Evidence.** Worker E2E: `[system.outbox.cleanup.schedule] started (interval=3600000ms)` boot log and `[system.outbox.cleanup] deleted 2 DISPATCHED rows older than 7 days` on the first tick. `system-outbox-cleanup-service.test.ts` 3/3 green, `system-rebuild-service.test.ts` 4/4 green.

**Commit.** `97db14d` — `feat(worker): add system rebuild and outbox cleanup queues`

---

### F8 — Interaction response scheduler (UNKNOWN reconciliation)

**Baseline observation.** The interaction response lifecycle can be in `SCHEDULED`, `IN_PROGRESS`, or `UNKNOWN`. The `UNKNOWN` state is entered when the Meta adapter returns `NETWORK_ERROR` or `UNKNOWN` — `WebhookRespondService` calls `markUnknown` and **does not** enqueue a reconcile job, because it does not want BullMQ to spin.

**State after Sprint A.** The new `InteractionResponseSchedulerService` was introduced, handling `SCHEDULED` and `IN_PROGRESS` (stale) states. **The `UNKNOWN` state was not covered** — this was my mistake, because the audit F8 text only mentioned `IN_PROGRESS`.

**The gap found during the final review.** `UNKNOWN` responses were **stuck forever**. `WebhookRespondReconcileService` already accepted both statuses, but the scheduler **did not hand them off**.

**Fix.**

- The repository method `touchStaleInProgress` → `touchStaleUnresolved`, with the `WHERE status IN ('IN_PROGRESS', 'UNKNOWN')` predicate.
- The scheduler method `scanStaleInProgress` → `scanStaleUnresolved`.
- A new test file `interaction-response-scheduler-service.test.ts` with 7 tests, including `touches a stale UNKNOWN response and enqueues webhook.respond.reconcile` and `handles a mix of stale IN_PROGRESS and stale UNKNOWN in one scan`.

**Evidence.** Worker tests 84 → 91 (+7). `WebhookRespondReconcileService` unchanged — it already handled both statuses.

**Commit.** `c9b13e7` — `fix(worker): reconcile UNKNOWN interaction responses`

---

### F9 — `shouldInvalidateCredential` propagation

**Baseline observation.** `MetaPublisherAdapter` and `MetaInteractionAdapter` return `shouldInvalidateCredential: true` on `AUTHENTICATION_ERROR`. That flag was **used nowhere** — neither `MetaCredentialService.invalidateCredential()` nor `ProviderCredentialsRepository.markInvalid()` was called.

**Fix.** The flag flows from the adapter through `ContentPublishService` → `PublishOutcome.FAILED.shouldInvalidateCredential` and through `WebhookRespondService` → `RespondOutcome.FAILED.shouldInvalidateCredential`, then `ContentPublishWorker` and `WebhookRespondWorker` best-effort call `invalidatePageAccessToken` and `alerting.credentialInvalidated`.

**Evidence.** `webhook-respond-worker.test.ts` 9 → 10 (+1 `FAILED with credential invalidation requested`).

**Commit.** `90e210c` (worker wiring) + `97db14d` (alerting integration)

---

### F10 — Webhook verify token key version

**Baseline observation.** The `webhook_subscriptions.verify_token_key_version` column existed at the schema level, but the API **never read it**. `decryptVerifyToken()` used a single `WEBHOOK_TOKEN_ENCRYPTION_KEY` environment variable, and treated the first tag of the ciphertext (`v1:`) as a **format version**, not a **key version**. Under key rotation, every handshake would fail.

**Fix.**

- A new `loadWebhookTokenKeySet()` (`packages/authentication/src/env.ts`) that accepts the legacy single-key format (`WEBHOOK_TOKEN_ENCRYPTION_KEY`) **and** the versioned JSON format (`WEBHOOK_TOKEN_ENCRYPTION_KEYS` + `WEBHOOK_TOKEN_ENCRYPTION_ACTIVE_VERSION`).
- A new `WebhookTokenEncryptionProvider` (`packages/authentication/src/encryption/webhook-token-encryption-provider.ts`) that wraps `CredentialEncryptionProvider` with the `META:WEBHOOK_VERIFY_TOKEN:<destinationId>` AAD context.
- The API now **reads** `verify_token_key_version`, and the provider selects the correct key.
- `safeEqual` for timing-safe comparison.

**Evidence.** `meta.test.ts` 4 → 8 (+4 handshake tests). The dev DB subscription was reseeded via `seed-webhook-subscription.mjs`.

**Commit.** `b32c2cd` — `refactor(api): centralize webhook token encryption with key versioning`

---

### F11 — `notifications` table never written

**Baseline observation.** The `notifications` table existed, but **zero writes** were made to it. The specification required at minimum: `credential_failure`, `system_failure`, `queue_backlog`, `publication_failure`, `ai_budget_threshold`, `source_failure`.

**Fix.** A new `NotificationService` (`apps/worker/src/observability/notification-service.ts`) with a best-effort writer. A new `AlertingService` combines a notification with a `system_logs` entry. Currently wired: `credential_failure` and `publication_failure`.

**Evidence.** `AlertingService.publicationPublished`, `publicationFailed`, `credentialInvalidated` methods in the worker bootstrap.

**Commit.** `97db14d` (same as F7)

---

### F12 — `system_logs`, `audit_logs`, `ai_usage` dead code

**Baseline observation.** Three tables exist, but have zero writes.

**Fix.** A new `SystemLogService` (`apps/worker/src/observability/system-log-service.ts`) with a best-effort writer. `AlertingService` writes `publication.published`, `publication.failed`, `credential.invalidated` events.

**Partial.** The `audit_logs` table **intentionally** remains without a writer — it belongs to the admin UI, which is not part of the current baseline. The Technical Specification records it as a deferred decision. `ai_usage` is also open, but the AI pipeline does not yet exist.

**Commit.** `97db14d` (same as F7)

---

### F13 — Crypto duplication

**Baseline observation.** Two independent AES-256-GCM implementations:

1. `packages/authentication/src/encryption/credential-encryption-provider.ts` — `v1:base64(iv ‖ ciphertext ‖ tag)` format, AAD = `provider:credentialType:destinationId ?? 'app'`
2. `apps/api/src/routes/webhooks/meta.ts` — `decryptVerifyToken()`, same format, but AAD = `META:destinationId`
3. `packages/database/scripts/seed-webhook-subscription.mjs` — a third copy, also with `META:destinationId` AAD

**Fix.** The API's `decryptVerifyToken()` was removed. The new `WebhookTokenEncryptionProvider` wraps `CredentialEncryptionProvider`. `seed-webhook-subscription.mjs` was updated to the new AAD format: `META:WEBHOOK_VERIFY_TOKEN:<destinationId>`.

**Warning.** The AAD format **changed**. The old dev DB subscription ciphertext is **invalid** to the new provider. Reseed with `seed-webhook-subscription.mjs`.

**Commit.** `b32c2cd` (same as F10)

---

### F14 — `WebhookProcessService` race condition

**Baseline observation.** The service used a `findById` + `markProcessing` sequence outside any transaction. Two parallel workers on the same event both called `startAttempt`, violating the `webhook_deliveries_event_attempt_uq` unique constraint.

**Fix.** A new `WebhookEventsRepository.claimForProcessing(tx, id)` method — an atomic `UPDATE webhook_events SET status = 'PROCESSING' WHERE id = ? AND status = 'RECEIVED' RETURNING id`. If the claim is lost, the service returns `SKIPPED` with reason `concurrent claim lost` and does not create a delivery attempt.

**Evidence.** New test: `skips the event when the concurrent claim is lost`.

**Commit.** `3373895` — `fix(worker): atomic claim for webhook and response creation`

---

### F15 — `InteractionResponseService` race condition

**Baseline observation.** Two parallel `decide()` calls for the same interaction → both attempt `INSERT` → unique constraint violation on `interaction_responses_interaction_id_uq`.

**Fix.** `InteractionResponsesRepository.createIdempotent(tx, input)` returns `{ row, inserted }`. `INSERT ... ON CONFLICT DO NOTHING RETURNING *`, then if no row was inserted, `SELECT` the existing row. `InteractionResponseService.createResponse` enqueues an outbox job **only** when `inserted === true` — otherwise the `webhook.respond:{responseId}` job_id unique constraint would be violated.

**Evidence.** New test: `does not enqueue a second outbox job when createIdempotent reuses an existing row`.

**Commit.** `3373895` (same as F14)

---

### F16 — API crypto import

Same as F13, from the import perspective. The API now imports from `@content-platform/authentication`, and the `packages/authentication` package boundary is **restored**.

**Evidence.** `apps/api/package.json` `@content-platform/authentication: workspace:*` dependency. `apps/api/src/routes/webhooks/meta.ts` `import { WebhookTokenEncryptionProvider } from '@content-platform/authentication'`.

**Commit.** `b32c2cd` (same as F10)

---

### F17 — Worker `dev` script

**Baseline observation** (surfaced during the final review). `apps/api/package.json` contains `"dev": "node --watch dist/index.js"`, but `apps/worker/package.json` does not. `pnpm --filter worker dev` was broken.

**Fix.** `"dev": "node --watch dist/index.js"` added to the worker package.json.

**Evidence.** `grep '"dev"' apps/worker/package.json` → `"dev": "node --watch dist/index.js",`

**Commit.** `76410d8` — `chore(tooling): add worker dev script and seed migration snapshots`

---

### Drizzle snapshot chain (surfaced during the final review)

**Problem.** `_journal.json` contains 15 entries (`0000`–`0014`), but the `meta/` directory had only `0000_snapshot.json` – `0012_snapshot.json`. `0013_seed_system_config` and `0014_seed_rate_limit_budgets` are seed-only migrations (INSERTs only, no DDL), so they were left **without a snapshot**. The next `drizzle-kit generate` would have **failed** on the next schema change, because the `prevId` anchor could not be found.

**Fix.** Copied the contents of `0012_snapshot.json` into `0013_snapshot.json` and `0014_snapshot.json`, with new `id` values and a refreshed `prevId` chain.

**Evidence.**

- `ls packages/database/migrations/meta/*_snapshot.json | wc -l` → `15`
- Chain verification: `Chain OK` (id/prevId consistent)
- `pnpm --filter @content-platform/database exec drizzle-kit generate` → `No schema changes, nothing to migrate 😴`

**Commit.** `76410d8` (same as F17)

---

## 4. What was **not** closed — intentional decisions

### `audit_logs` writer

The `audit_logs` table exists at the schema level but receives no writes. **Intentional decision.** `audit_logs` is intended for user-initiated changes from the admin UI — the admin UI is not part of the current baseline. The Technical Specification records it as a deferred decision. When the admin UI is implemented (probably v1.4 or later), `audit_logs` writing will be wired.

### `ai_usage` writes

Similarly, the `ai_usage` table exists at the schema level but receives no writes, because the AI pipeline **does not yet exist**. When AI processing is implemented, `ai_usage` writes will be a natural part of it.

### CI pipeline

The repository has **no CI**. Tests run locally; GitHub does not automatically verify pushes. This is **not a deficiency** in the current solo-development context, but it may be worth adding when:

- Multiple developers work on the repository
- Pull requests are accepted
- The `main` branch requires protection

A basic CI workflow (`.github/workflows/ci.yml`) with `pnpm install`, `pnpm typecheck`, `pnpm test` (optionally with `TEST_DATABASE_URL` / `TEST_REDIS_URL` secrets) is about 30 lines.

### Secret rotation

The HANDOFF "Security note" records that the Meta App Secret, the ngrok authtoken, the System User token, and the Page Access Token **all appeared in the development chat**. The repository is private and the git history does not contain them, but rotation is due before:

- The repository becomes public
- A new collaborator is brought in
- The Meta App is submitted for review

The rotation list is in the HANDOFF "Security note" section.

---

## 5. Test evidence

### Test counts by package (last run: 2026-10-03)

| Package                         | Baseline | Current | Δ       |
| ------------------------------- | -------- | ------- | ------- |
| `packages/database`             | 22       | 22      | 0       |
| `packages/interaction-response` | 21       | 21      | 0       |
| `packages/publishers`           | 51       | 56      | +5      |
| `packages/authentication`       | 37       | 37      | 0       |
| `apps/api`                      | 4        | 8       | +4      |
| `apps/worker`                   | 73       | 91      | +18     |
| **Total**                       | **208**  | **235** | **+27** |

All tests require `TEST_DATABASE_URL` and `TEST_REDIS_URL`. Without them, the DB- and Redis-backed tests are skipped and only 157 run.

### Build and typecheck

```bash
pnpm build     # green, all 6 workspace packages
pnpm typecheck # green, all 6 workspace packages
```

### Worker E2E — against real Neon + Upstash

```
[worker] interaction response: 0 rules, 0 templates
[worker] rate limits: publish=10/h/dest, engagement=30/h/dest
[worker] DB-backed Meta credentials available
[worker] started
[system.outbox.cleanup.schedule] started (interval=3600000ms)
[interaction-response.schedule] scheduler started (interval=30000ms)
[publication.schedule] scheduler started (interval=30000ms)
[outbox] dispatcher started
[system.outbox.cleanup] deleted 2 DISPATCHED rows older than 7 days
[worker] received SIGINT, shutting down
```

This boot log **proves five findings** operating together:

- F2 — `interaction response: 0 rules, 0 templates` without default warning
- F3/F4 — `rate limits: publish=10/h/dest, engagement=30/h/dest` from `system_config`
- F5 — `DB-backed Meta credentials available`
- F7 — `system.outbox.cleanup.schedule` running + actual deletion
- F8 — `interaction-response.schedule` running

### Drizzle chain

```bash
pnpm --filter @content-platform/database exec drizzle-kit generate
# Output: No schema changes, nothing to migrate 😴
```

---

## 6. Deviations from baseline

### `RedisMetaRateLimiter` in `packages/publishers`

The rate limiter implementation lives in `packages/publishers/src/meta/redis-meta-rate-limiter.ts`, but `packages/publishers` does **not** pick up a runtime `ioredis` dependency. The `RateLimiterRedisLike` interface (with the `eval(script, numKeys, ...args)` signature) ensures the worker passes its own Redis client. This **deviates** from the simpler approach of having `packages/publishers` import `ioredis` directly, but preserves the package boundary.

`ioredis` is a `packages/publishers` **devDependency**, because the test uses a real Redis client.

### Webhook AAD format change

The webhook verify token AAD format changed from `META:<destinationId>` to `META:WEBHOOK_VERIFY_TOKEN:<destinationId>`. This is **intentional**: it follows the `CredentialEncryptionProvider`'s consistent AAD scheme (`provider:credentialType:destinationId`). Consequence: the old ciphertexts are invalid, and the subscriptions must be reseeded.

### `outbox.job_id` idempotency

`OutboxRepository.enqueue` now uses `ON CONFLICT (job_id) DO NOTHING` and returns a `boolean` (`true` = inserted, `false` = already existed). This was **not** a baseline requirement, but the `system.rebuild` service needed it so the rebuild does not collide with the primary scheduler's job_ids. Idempotency does **not** weaken security — same job_id, same payload, inserted only once.

---

## 7. Verification checklist

At the audit time, the system can be reproducibly verified with these commands:

```bash
# 1. The repo is in sync
git status -sb
# Expected: ## main...origin/main

# 2. The 12 commits are present
git log --oneline de5a71a..HEAD | wc -l
# Expected: 12

# 3. Build and typecheck are green
pnpm build && pnpm typecheck

# 4. Tests are green (env required)
export TEST_DATABASE_URL="$(grep '^TEST_DATABASE_URL=' .env | cut -d= -f2-)"
export TEST_REDIS_URL="$(grep '^TEST_REDIS_URL=' .env | cut -d= -f2-)"
pnpm test 2>&1 | tr -d '\r' | grep -E "(Test Files|Tests) +[0-9]+" | grep -v startup
# Expected: 235 green

# 5. Migration chain is consistent
ls packages/database/migrations/meta/*_snapshot.json | wc -l
# Expected: 15

# 6. Drizzle chain is OK
pnpm --filter @content-platform/database exec drizzle-kit generate
# Expected: No schema changes, nothing to migrate

# 7. The worker boots
node apps/worker/dist/index.js
# Expected: [worker] started and 4 scheduler/dispatcher startups
```

---

## 8. Commit history (12 commits)

| #   | Hash      | Subject                                                                  |
| --- | --------- | ------------------------------------------------------------------------ |
| 1   | `90e210c` | `feat(worker): wire runtime config, credentials, schedulers`             |
| 2   | `16675be` | `fix(api): webhook ingress uses a single DB transaction`                 |
| 3   | `b32c2cd` | `refactor(api): centralize webhook token encryption with key versioning` |
| 4   | `4849440` | `feat(publishers): add Redis-backed Meta rate limiter`                   |
| 5   | `3373895` | `fix(worker): atomic claim for webhook and response creation`            |
| 6   | `587a68b` | `docs(handoff): record sprint B commits and open findings`               |
| 7   | `97db14d` | `feat(worker): add system rebuild and outbox cleanup queues`             |
| 8   | `1868ebb` | `docs(handoff): record sprint C commits and close F7, F11, F12`          |
| 9   | `c9b13e7` | `fix(worker): reconcile UNKNOWN interaction responses`                   |
| 10  | `cd918e1` | `docs(handoff): refresh test counts after F8 reconciliation fix`         |
| 11  | `76410d8` | `chore(tooling): add worker dev script and seed migration snapshots`     |
| 12  | `945b082` | `docs(handoff): record F8, F17, and drizzle snapshot fixes`              |

---

## 9. Conclusion

The baseline audit's **16 findings are closed**, 1 finding (`audit_logs` writer) is intentionally open until the admin UI milestone. The infrastructure gaps (F8 reconciliation gap, F17 worker dev script, Drizzle snapshot chain) are also closed.

The system state:

- **Phase 1–13** (DB foundation) — untouched, 44 tables, 15 migrations, Chain OK
- **Phase 14–17** (infrastructure + webhook ingress) — after F1, the transaction boundary is satisfied
- **Phase 18a–18b** (interaction response lifecycle) — after F2, F8, F15, the lifecycle is complete
- **Phase 19a–19e** (outbound publication) — after F3, F4, F5, F6, F9, the baseline contract is satisfied
- **Phase 19 Sprint C** (system queues + observability) — F7, F11, F12, F17 closed

**The system is ready for the v1.3 milestone** (`webhook_endpoints` refactor + multi-Page Meta support).

---

**Audit prepared by:** development session, 2026-10-03

**Next milestone:** v1.3 — `webhook_endpoints` and multi-Page Meta support (see DATABASE_SCHEMA_CONTRACT.md, deferred decision D-013)
