# Content Platform — v1.3 Development Plan

**Plan date:** 2026-10-04
**Status:** approved for execution
**Predecessor audit:** [`docs/audit/v1-3-readiness-audit-2026-10-04.md`](../audit/v1-3-readiness-audit-2026-10-04.md) (CONDITIONAL PASS)
**Contract decisions:** D-013 (`webhook_endpoints`), D-016 (provider-aware natural key)
**Starting point:** `main` @ commit `cbfab93` (post-Sprint E; 251 tests green, CI active on `main`)

---

## 1. Executive Summary

v1.3 delivers two foundational capabilities that unlock multi-page Meta
support and future non-Meta providers:

1. **`webhook_endpoints`** — an App-level webhook configuration aggregate
   that owns the verify token, referenced by `webhook_subscriptions`
   instead of being duplicated per subscription (D-013).
2. **Provider-aware `external_interactions` natural key** — the composite
   `(interaction_type, external_interaction_id)` becomes
   `(provider, external_interaction_id)` (D-016).

Both are **aggregate boundary changes**, not additive schema evolution.
They require coordinated migration, repository, service, and application
changes, and they must not be introduced incrementally.

Alongside these two schema-level workstreams, v1.3 also closes the
readiness-audit findings **N3** and **N4**, which correct the semantics
of two partially-completed worker integrations from Phase 20 (the
credential fallback removal and the scheduler credential gate).

The plan supersedes three incorrect premises that the original v1.3
draft recorded (see §3): the migration number (`0012` → `0014`), the
verify-token AAD binding, and the "wiring missing" framing for F5/F6.

**Migration numbering starts at `0015`.**

---

## 2. Scope

### 2.1 In scope

| Workstream | Deliverable                                                                                                                                                            | Contract reference              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **F5a**    | Remove the `META_PAGE_ACCESS_TOKEN` fallback from the worker credential path; switch `refresh-page-token.mjs` to DB writes; preserve error category on `getCredential` | readiness audit N4              |
| **F6**     | Correct the publication scheduler's credential gate semantics: block on `UNKNOWN`, make the gate mandatory, emit notifications with a dedup window                     | readiness audit N3, N10         |
| **D-013a** | Introduce `webhook_endpoints` table; expand `webhook_subscriptions` to reference it                                                                                    | DATABASE_SCHEMA_CONTRACT §D-013 |
| **D-013b** | Handshake dual-read: verify against the endpoint first, fall back to the subscription                                                                                  | DATABASE_SCHEMA_CONTRACT §D-013 |
| **D-013c** | Backfill script, verify token re-encryption under the new AAD, drop the duplicated columns                                                                             | DATABASE_SCHEMA_CONTRACT §D-013 |
| **D-016**  | Add `provider` column to `external_interactions`; widen the natural key                                                                                                | DATABASE_SCHEMA_CONTRACT §D-016 |

### 2.2 Out of scope (explicitly)

The following are **not** part of v1.3. Recording them here prevents a
future planning round from assuming their absence is an oversight.

| Item                                                                        | Reason                                                                                                                                                                                                                                                   | Target milestone                 |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **Redis Pub/Sub credential invalidation channel**                           | Only required for multi-instance deployment. The current topology is a single worker process. No credential cache is introduced in v1.3 either, so cross-instance cache coherence is not a concern.                                                      | v1.4+, when horizontally scaling |
| **In-memory credential cache**                                              | The Redis-backed rate limiter bounds Meta API calls to 10/h/destination (publish) and 30/h/destination (engagement). A DB lookup of 2–5 ms is negligible against a Meta API call of 200–2000 ms. The cache would add complexity without measurable gain. | v1.4+, if volume demands         |
| **Scheduled credential validation**                                         | Not required: the invalidation-on-401 path plus the scheduler gate already cover the operational need.                                                                                                                                                   | v1.4+                            |
| **`audit_logs` writer**                                                     | Deferred to the admin UI milestone. Documented in the sprint audit §4.                                                                                                                                                                                   | v1.4+                            |
| **Analytics read models** (`meta_posts`, `meta_comments`, `meta_reactions`) | Explicitly beyond v1.3 in DATABASE_SCHEMA_CONTRACT §Additional non-goals.                                                                                                                                                                                | v1.5+                            |
| **Multi-provider extraction / response policy**                             | The schema is provider-aware where practical, but extraction, response policy, and credential validation remain Meta-specific.                                                                                                                           | v1.5+                            |
| **`provider_credential_history` table**                                     | Forensic requirements do not yet justify it. D-015.                                                                                                                                                                                                      | Not scheduled                    |
| **CI credential cache / secret rotation automation**                        | The secret rotation runbook in HANDOFF is sufficient.                                                                                                                                                                                                    | Not scheduled                    |

---

## 3. Preconditions — Corrected Facts

The readiness audit identified four corrections that the original v1.3
draft did not contain. They are recorded here as the **authoritative
starting facts** for this plan.

### 3.1 Migration numbering (N1)

The migration journal ends at `0014` (`0014_seed_rate_limit_budgets`),
not `0012`. The v1.3 migrations therefore start at `0015`:

```
0015   webhook_endpoints EXPAND
0016   external_interactions provider EXPAND
0017   CONTRACT (tighten constraints)
```

All references to `0013`, `0014`, or `0015` as v1.3 migrations are
incorrect and must not appear in the implementation.

### 3.2 Verify-token AAD binding (N2)

The actual AAD context in the running system is:

```
META:WEBHOOK_VERIFY_TOKEN:<destination_id>
```

This is the form produced by `WebhookTokenEncryptionProvider` in
`@content-platform/authentication`. The D-013 AAD transition is
therefore:

```
META:WEBHOOK_VERIFY_TOKEN:<destination_id>
       ↓ (backfill script re-encrypts)
META:WEBHOOK_VERIFY_TOKEN:<endpoint_id>
```

The `META:<destination_id>` form that the original draft assumed does
**not** exist and must not be used in the backfill.

### 3.3 F5a re-scope (N4)

The `MetaCredentialService` is already wired into every Meta path in
the worker (Phase 20 Sprint A, commit `90e210c`). What remains for v1.3
F5a is:

1. **Remove the `META_PAGE_ACCESS_TOKEN` environment fallback** from
   `buildGetAccessToken`. When the DB credential is absent, the worker
   must fail closed (throw, not silently fall back).
2. **Switch `packages/database/scripts/refresh-page-token.mjs`** from
   rewriting `.env` to calling `MetaCredentialService.storeCredential`
   (or writing directly to `provider_credentials` with the encryption
   provider).
3. **Preserve error category** from `getCredential`: a missing
   credential and an `INVALID` credential must map to distinguishable
   error categories so downstream `shouldInvalidateCredential`
   handling stays correct.
4. **No cache, no Pub/Sub.** The DB lookup at every call is the design
   decision (see §2.2).

The DoD for F5a is therefore **fallback removal + script conversion +
error taxonomy**, not "wire the credential service" — that work is
already done.

### 3.4 F6 re-scope (N3, N10)

The scheduler credential gate exists (Phase 20 Sprint A + Sprint E).
What remains for v1.3 F6 is a **semantics correction**, not wiring:

| Aspect                         | Current behavior                           | v1.3 target behavior                                                                                           |
| ------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `UNKNOWN` health status        | Allowed (enqueue proceeds)                 | Blocked (treated like a temporary unknown state; the scheduler defers)                                         |
| `credentialService` dependency | Optional; absent = no gate                 | **Mandatory** in production; the worker must refuse to start if the credential bundle is unavailable           |
| Blocked publication status     | `FAILED`                                   | `FAILED` (kept — resetting to `SCHEDULED` re-enters the scan window and risks a loop)                          |
| Notification                   | Emitted per blocked publication (Sprint E) | Emitted with a **deduplication window** per destination (e.g. one notification per 6h) to prevent alert storms |

The `INVALID` case stays as implemented in Sprint E.

---

## 4. Migration Plan

Three migrations, in strict order. Each is a separate file.

### 4.1 `0015_webhook_endpoints_expand.sql`

Additive only. No existing column is modified or dropped.

```sql
CREATE TABLE webhook_endpoints (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        varchar(32) NOT NULL,
  name            text NOT NULL,
  verify_token_encrypted      text NOT NULL,
  verify_token_key_version    integer NOT NULL,
  status          varchar(32) NOT NULL,
  last_verified_at   timestamptz,
  last_rotated_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_endpoints_status_check
    CHECK (status IN ('ACTIVE', 'PAUSED', 'DISABLED')),
  CONSTRAINT webhook_endpoints_key_version_check
    CHECK (verify_token_key_version > 0)
);

CREATE UNIQUE INDEX webhook_endpoints_provider_name_uq
  ON webhook_endpoints (provider, name);

-- webhook_subscriptions gains a nullable reference. The column stays
-- nullable during EXPAND; the backfill in 0017 makes it NOT NULL.
ALTER TABLE webhook_subscriptions
  ADD COLUMN endpoint_id uuid REFERENCES webhook_endpoints(id)
    ON DELETE RESTRICT;

CREATE INDEX webhook_subscriptions_endpoint_id_idx
  ON webhook_subscriptions (endpoint_id);
```

**Rollback:** `DROP TABLE webhook_endpoints CASCADE; ALTER TABLE
webhook_subscriptions DROP COLUMN endpoint_id;`

### 4.2 `0016_external_interactions_provider_expand.sql`

```sql
ALTER TABLE external_interactions
  ADD COLUMN provider varchar(32);

CREATE INDEX external_interactions_provider_external_id_idx
  ON external_interactions (provider, external_interaction_id);
```

The old composite unique index `(interaction_type,
external_interaction_id)` remains in place during EXPAND. The new index
is non-unique until 0017.

**Rollback:** `DROP INDEX ...; ALTER TABLE external_interactions DROP
COLUMN provider;`

### 4.3 `0017_webhook_endpoints_contract.sql`

Application-level backfill runs **before** this migration (see §5.3).

```sql
-- Both columns are now guaranteed populated by the backfill script.
ALTER TABLE webhook_subscriptions
  ALTER COLUMN endpoint_id SET NOT NULL;

-- Drop the duplicated verify token from the subscription.
ALTER TABLE webhook_subscriptions
  DROP COLUMN verify_token_encrypted,
  DROP COLUMN verify_token_key_version;

-- Provider-aware natural key switch.
DROP INDEX external_interactions_type_external_id_uq;

ALTER TABLE external_interactions
  ALTER COLUMN provider SET NOT NULL;

CREATE UNIQUE INDEX external_interactions_provider_external_id_uq
  ON external_interactions (provider, external_interaction_id);

DROP INDEX external_interactions_provider_external_id_idx;
```

**Rollback:** requires restoring the dropped columns and index from a
backup. The 0017 migration is the point of no return; it must only be
applied after the backfill and dual-read window have been verified in
production.

---

## 5. Phase Breakdown

Each phase is a distinct PR with its own DoD. Phases execute in the
order listed.

### 5.1 Phase F5a — Credential fallback removal

**Files:**

- `apps/worker/src/credentials/get-access-token.ts`
- `apps/worker/src/config.ts`
- `packages/database/scripts/refresh-page-token.mjs`
- `.env.example`

**Changes:**

- Remove the `fallbackToken` parameter and all its call sites.
- `getAccessToken` throws when the DB credential is absent or the bundle
  is unavailable. The two failure modes are distinguishable in the error
  message/category.
- `.env.example` no longer documents `META_PAGE_ACCESS_TOKEN`. The
  variable is deleted from the file.
- `refresh-page-token.mjs` uses `MetaCredentialService.storeCredential`
  (via a small Node wrapper that imports the compiled
  `@content-platform/authentication` package).

**DoD:**

- A worker with no `META_PAGE_ACCESS_TOKEN` env var and no DB credential
  for a destination fails the outbound call with `AUTHENTICATION_ERROR`,
  never falls back.
- `refresh-page-token.mjs` writes to `provider_credentials` and never
  touches `.env`.
- Unit test: `getAccessToken` throws when the DB credential is absent.
- Unit test: `getAccessToken` throws when the credential is `INVALID`
  (this was already the case, but is now the only path).

### 5.2 Phase F6 — Gate semantics correction

**Files:**

- `apps/worker/src/publication/publication-scheduler-service.ts`
- `apps/worker/src/publication/publication-scheduler-service.test.ts`
- `apps/worker/src/index.ts`
- `packages/database/migrations/0018_notification_dedup.sql` (if a
  dedup window is stored in the DB)

**Changes:**

- Block on `UNKNOWN` as well as `INVALID`.
- Make `credentialService` a required constructor parameter. The worker
  bootstrap fails to start if `credentialBundle.available` is false.
- Notification dedup: the `AlertingService.publicationBlocked` call is
  guarded by a per-destination rate limit (in-memory for a single
  worker; DB-backed if the dedup needs to survive restarts).

**DoD:**

- Scheduler gate test suite updated: `UNKNOWN` now blocks.
- Worker startup test: missing credential bundle aborts the process with
  a clear error.
- Notification for a blocked publication is emitted at most once per
  dedup window per destination.
- Existing 9 gate tests updated; +3 new tests for the semantics.

### 5.3 Phase D-013a — `webhook_endpoints` schema and repository

**Files:**

- `packages/database/migrations/0015_webhook_endpoints_expand.sql`
- `packages/database/src/schema/webhook/webhook-endpoints.ts` (new)
- `packages/database/src/repositories/webhook-endpoints-repository.ts` (new)
- `packages/database/src/repositories/webhook-subscriptions-repository.ts`
  (extend with `endpoint_id` field)

**DoD:**

- Migration applies cleanly on a fresh test DB and on a dev DB at the
  current HEAD.
- Repository tests: create, read, find by provider+name, status update.
- `webhook_subscriptions.endpoint_id` is readable but nullable.

### 5.4 Phase D-013b — Handshake dual-read

**Files:**

- `apps/api/src/routes/webhooks/meta.ts`

**Changes:**

- The GET handshake first attempts endpoint-scoped verification: look up
  `webhook_endpoints` by `provider = 'META'` and `status = 'ACTIVE'`,
  decrypt with AAD `META:WEBHOOK_VERIFY_TOKEN:<endpoint_id>`, compare.
- If no endpoint matches, fall back to the existing per-subscription
  path (AAD `META:WEBHOOK_VERIFY_TOKEN:<destination_id>`).
- The dual-read window lasts until 0017 is applied.

**DoD:**

- API test: endpoint-scoped match returns 200 with the challenge.
- API test: subscription-scoped (legacy AAD) match returns 200.
- API test: mixed state (some endpoints, some legacy subscriptions) both
  work.

### 5.5 Phase D-013c — Backfill and cleanup

**Files:**

- `packages/database/scripts/backfill-webhook-endpoints.mjs` (new)
- `packages/database/migrations/0017_webhook_endpoints_contract.sql`

**Backfill script (runs once, before 0017):**

For each active `webhook_subscriptions` row:

1. Create one `webhook_endpoints` row per distinct
   `(provider, verify_token decryption group)`. In practice, a single
   App-level endpoint per provider, since the verify token is
   App-scoped.
2. Re-encrypt the verify token under the new AAD
   (`META:WEBHOOK_VERIFY_TOKEN:<endpoint_id>`).
3. Set `webhook_subscriptions.endpoint_id` to the new endpoint.
4. Leave the legacy columns populated until 0017 runs.

The script is idempotent: re-running it on a partially-backfilled DB
skips rows whose `endpoint_id` is already set.

**DoD:**

- Backfill script test: idempotent, correct endpoint created, correct
  AAD.
- 0017 applies cleanly after backfill.
- Handshake still works after 0017 (only endpoint path).
- API test: no residual subscription-scoped matches after 0017.

### 5.6 Phase D-016 — Provider-aware natural key

**Files:**

- `packages/database/migrations/0016_external_interactions_provider_expand.sql`
- `packages/database/migrations/0017_webhook_endpoints_contract.sql`
  (the constraint swap)
- `packages/database/src/schema/webhook/external-interactions.ts`
- `packages/database/src/repositories/external-interactions-repository.ts`

**Changes:**

- Migration 0016 adds the nullable `provider` column and a non-unique
  index.
- Backfill: `UPDATE external_interactions SET provider = 'META' WHERE
provider IS NULL;` — runs inside the 0017 migration transaction,
  before the constraint change. Guarded by an assertion that the count
  of rows with `provider IS NULL` reaches zero.
- Migration 0017 drops the old unique index, makes `provider NOT NULL`,
  adds the new unique index `(provider, external_interaction_id)`.
- Repository `upsertMonotonic` is updated to write `provider = 'META'`
  on every insert (the D-013 work does not change this; the extractor
  already knows the provider).

**DoD:**

- Migration test: dev DB with N rows migrates without conflict.
- Repository test: `upsertMonotonic` on a row with `provider = 'META'`
  works as before.
- Unit test: the `(provider, external_interaction_id)` unique constraint
  rejects a duplicate with the same provider; allows the same
  `external_interaction_id` with a different provider.

---

## 6. Operational Considerations

### 6.1 Deployment order

The three migrations and the two application phases (F5a, F6) are
**not independent** in the deployment sequence. The required order:

```
1. Deploy application with dual-read handshake (D-013b)
   and backfill script present.
2. Run 0015 (EXPAND webhook_endpoints).
3. Run backfill-webhook-endpoints.mjs.
4. Run 0016 (EXPAND external_interactions provider).
5. Run 0017 (CONTRACT).
6. Deploy application without the legacy handshake path.
7. Deploy F5a (fallback removal) and F6 (gate semantics) as separate
   application releases.
```

Steps 1–5 can be prepared and tested on the dev DB before any production
deployment.

### 6.2 Rollback

- **0015 rollback:** safe — no existing column is modified.
- **0016 rollback:** safe — the `provider` column is dropped.
- **0017 rollback:** requires restoring dropped columns. **Not
  reversible with DDL alone.** A full pre-0017 backup of
  `webhook_subscriptions` and `external_interactions` is mandatory
  before 0017 runs.

### 6.3 Secret rotation

The rotation of `WEBHOOK_TOKEN_ENCRYPTION_KEY` is now fully independent
of the endpoint migration: the endpoint row carries the
`verify_token_key_version`, and the encryption provider selects the key
by version. A rotation can be performed at any point after D-013c
without a coordinated downtime.

---

## 7. Test Plan

| Layer      | Tests added                                                  | Location                                       |
| ---------- | ------------------------------------------------------------ | ---------------------------------------------- |
| Migration  | 3 (0015/0016/0017 on a fresh DB; 0017 idempotency)           | `packages/database/src/**/*.migration.test.ts` |
| Repository | 4 (webhook_endpoints CRUD; external_interactions provider)   | `packages/database/src/repositories/*.test.ts` |
| API        | 3 (endpoint-scoped, subscription-scoped, dual-read)          | `apps/api/src/routes/webhooks/*.test.ts`       |
| Worker     | 3 (+ gate semantics: UNKNOWN, mandatory, notification dedup) | `apps/worker/src/**/*.test.ts`                 |
| Backfill   | 2 (fresh, idempotent re-run)                                 | `packages/database/scripts/*.test.mjs`         |
| Credential | 2 (no fallback, no bundle)                                   | `apps/worker/src/credentials/*.test.ts`        |

**Expected new total: 251 + 17 = 268 tests.**

The CI runs the full suite against the real Neon and Upstash. The
`pnpm lint` exclusion (HANDOFF pending item #7) remains; it is not a
v1.3 concern.

---

## 8. Risk Map

| Area                                            | Rating                                              | Mitigation                                                                                                                                        |
| ----------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webhook_endpoints` backfill (D-013c)           | **High** — touches the live verify token            | Backfill script is idempotent; runs in a transaction; dual-read window allows rollback; pre-0017 backup mandatory                                 |
| AAD re-encryption in backfill                   | **High** — an error invalidates all handshakes      | Unit test verifies the AAD string; dry-run mode in the script prints the planned re-encryptions without writing                                   |
| `external_interactions` provider switch (D-016) | **Medium** — the backfill must complete before 0017 | The 0017 migration transaction asserts `provider IS NOT NULL` on every row before the constraint swap; a failed assertion aborts the migration    |
| F5a fallback removal                            | **Medium** — removes the last env-based safety net  | Deploy only after every destination has a `provider_credentials` row; the readiness audit's `refresh-page-token.mjs` conversion is a precondition |
| F6 gate mandatory                               | **Low** — the semantics change is well-scoped       | Rollout behind a worker config flag is not needed; the change is purely internal                                                                  |
| Notification dedup window                       | **Low**                                             | In-memory for single-worker; a future multi-worker rollout re-evaluates                                                                           |

---

## 9. Definition of Done

The v1.3 milestone is complete when:

- [ ] Migrations `0015`, `0016`, `0017` are applied to the dev and test
      DBs.
- [ ] The backfill script has run and `webhook_endpoints` is populated
      for every active Meta subscription.
- [ ] The API handshake works only through the endpoint path (the
      subscription path is removed).
- [ ] `external_interactions.provider` is `NOT NULL` and the unique
      constraint is `(provider, external_interaction_id)`.
- [ ] F5a: the env fallback is removed; `refresh-page-token.mjs` writes
      to the DB; no cache, no Pub/Sub.
- [ ] F6: `UNKNOWN` blocks; the gate is mandatory; notifications are
      deduplicated.
- [ ] All 268 tests pass locally and in CI.
- [ ] The `HANDOFF.md` snapshot reflects the v1.3 state.
- [ ] The `sprint-audit` or a new `v1-3-audit-2026-XX-XX.md` records the
      closure.

---

## 10. Not in v1.3 (deferred to v1.4+)

- **Redis Pub/Sub credential invalidation channel** — see §2.2. Only
  needed for multi-instance deployment. No cache is introduced in v1.3,
  so cross-instance coherence is moot.
- **In-memory credential cache** — see §2.2.
- **Scheduled credential validation** — see §2.2.
- **`audit_logs` writer** — admin UI milestone.
- **Analytics read models** (`meta_posts`, `meta_comments`,
  `meta_reactions`) — v1.5+.
- **Multi-provider extraction / response policy** — v1.5+.
- **`provider_credential_history` table** — D-015, not scheduled.
- **CI credential cache** — not scheduled.

---

## 11. References

- [`docs/audit/v1-3-readiness-audit-2026-10-04.md`](../audit/v1-3-readiness-audit-2026-10-04.md) — the audit this plan answers.
- [`docs/audit/sprint-audit-2026-10-03.md`](../audit/sprint-audit-2026-10-03.md) — the Phase 20 remediation report.
- [`docs/architecture/DATABASE_SCHEMA_CONTRACT.md`](../architecture/DATABASE_SCHEMA_CONTRACT.md) — D-013, D-016, and the v1.2 non-goals list.
- [`HANDOFF.md`](../../HANDOFF.md) — current state snapshot and pending items.
