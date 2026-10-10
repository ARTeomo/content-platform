# Handoff — Project State

This document records the project state at a milestone boundary. It is
intended to be read first when resuming work in a new session.

**Snapshot date:** 2026-10-09
**Branch:** `chore/downgrade-typescript-5.9.3`
**HEAD:** `83a5e9e` — `docs(tooling): add TypeScript downgrade runbook`
**Relationship to `main`:** 2 ahead / 0 behind. `main` HEAD is
`7fe1e1e` — `fix(worker): wire subscription health writes into
webhook.process`. The branch is pushed to origin; no open or closed PR
exists for it. (CONFIRMED 2026-10-09: `git rev-list --count`,
`git log main`, branch status.)
**Working tree:** clean. (CONFIRMED 2026-10-09: `git status --porcelain`
empty before and after every inspection command.)
**Repository:** https://github.com/ARTeomo/content-platform

---

## Status at a glance (2026-10-09, verified this session)

Everything in this section was re-verified against the checked-out
files, Git history, configuration, migrations, source, tests, and
documentation on 2026-10-09. Read-only inspection commands only; the
only writes anywhere were diagnostic outputs redirected to the system
temp directory, outside the repository.

### Gates executed at `83a5e9e` (all read-only; exact results)

| Check           | Command (as executed)                                                                                                      | Result                                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Format          | `pnpm format:check`                                                                                                        | **PASS** (exit 0)                                                                                                                    |
| Typecheck       | per-package `tsc --noEmit -p tsconfig.json --tsBuildInfoFile /tmp/...` (6 packages; build-info redirected out of the repo) | **PASS 6/6** (exit 0 each)                                                                                                           |
| Migration files | `drizzle-kit check` from `packages/database`                                                                               | PASS ("Everything's fine") — journal/snapshot consistency only; **NOT** contract-conformance evidence (see CP-F-01)                  |
| Unit tests      | `env -u TEST_DATABASE_URL -u TEST_REDIS_URL pnpm test`                                                                     | **PASS (exit 0): 172 passed / 98 skipped / 270 tests, 31 files**                                                                     |
| Lint baseline   | `pnpm exec eslint . -f json`                                                                                               | 138 messages: 118 errors + 20 warnings; **14 fatal parse errors, all on `.mjs` operational scripts (CP-F-04, configuration defect)** |

Per-package test detail (DB/Redis env deliberately unset):
`packages/database` 0 passed / 28 skipped; `packages/interaction-response`
26 passed; `packages/publishers` 51 passed / 5 skipped;
`packages/authentication` 24 passed / 13 skipped; `apps/api` 0 / 10
skipped; `apps/worker` 71 passed / 42 skipped.

**Interpretation limits (binding):**

- The passing test run with `TEST_DATABASE_URL` / `TEST_REDIS_URL`
  unset is **not** evidence that the 98 skipped integration tests pass.
  It is evidence only that the 172 non-gated tests pass. The skipped
  majority includes the entire `packages/database` and `apps/api`
  suites. 13 test files issue `TRUNCATE ... RESTART IDENTITY CASCADE`
  fixtures (CONFIRMED by grep); they must never run against shared or
  production databases.
- `drizzle-kit check` validates the migration journal/snapshot chain.
  It does not validate the §20 Path A governance layer (Bridge, Hard
  Gates, advisory lock, preservation baseline, digests), which remains
  unimplemented (CP-F-01).
- Not executed this session (would write into the repository or
  external state, or was out of scope): `pnpm build` (writes `dist/`),
  `pnpm install --frozen-lockfile` (modifies `node_modules`),
  migrations, backfill, any DB/Redis/provider access, any GitHub
  Actions inspection. The runbook's validation matrix still lists
  `pnpm build` and `pnpm install --frozen-lockfile` as pending; that
  listing remains accurate.
- No runtime/E2E behavior was exercised this session. All runtime
  claims below are static source verifications, labeled as such.

### Toolchain (CONFIRMED)

- Node.js 22.x (`.nvmrc` = `22`; observed v22.21.0 during this session).
- pnpm **12.3.4** (`packageManager`), engines `node >=22`, `pnpm >=12`.
- TypeScript **5.9.3** — root `package.json`, `pnpm-workspace.yaml`
  override (`typescript: 5.9.3`), all six workspace manifests, lockfile.
  Downgrade commit `28ffa40` touches exactly 9 files (7 manifests +
  `pnpm-workspace.yaml` + `pnpm-lock.yaml`; CONFIRMED via
  `git show --stat`).
- ESLint 10.10.0, `@eslint/js` 10.0.1, `typescript-eslint` 8.70.0
  (peer range `>=4.8.4 <6.1.0` — 5.9.3 in range), Prettier 3.9.6,
  Drizzle ORM 0.45.2 / Kit 0.31.10, Vitest 5.0.0.
- Six active workspace packages: `apps/api`, `apps/worker`,
  `packages/database`, `packages/authentication`,
  `packages/interaction-response`, `packages/publishers`.
  `apps/admin` is a scaffold without its own `package.json` /
  `tsconfig.json` and is not an active workspace package.

### Do-NOT-run conditions (binding until the cited items close)

1. **No production migration of a populated v1.2 database.** The
   v1.3.1 contract's Path A governance (Compatibility Bridge,
   Hard Gates #1/#2, session-level advisory lock per INVARIANT-08/20,
   immutable preservation baseline per INVARIANT-22/§20.2.3 step 1a,
   §2.8 canonical-JSON SHA-256 digests per INVARIANT-19, §20.2.9
   session state machine) is CONFIRMED present in the contract text and
   CONFIRMED absent from the implementation (migrations 0015–0018 +
   `backfill-webhook-endpoints.mjs` + plain `drizzle-kit migrate`).
   Dev/recreatable databases and greenfield Path B only. (CP-F-01;
   owner decision OPEN.)
2. **No destination deletion by any path.** `interaction_responses.
destination_id` is NOT NULL with an `ON DELETE SET NULL` FK in the
   Drizzle schema (`interaction-responses.ts:49-51`) and in the applied
   migration `0011_natural_orphan.sql:58`; the contract mandates
   RESTRICT (§5.41, line 2081; rationale lines 2114-2116). Any delete
   of a referenced destination fails with a NOT NULL violation.
   (CP-F-02; corrective proposal WP-1, unimplemented.)
3. **No CI lint gate** until CP-F-04 is fixed and the lint baseline is
   triaged per WP-3/WP-8; adding it now would block every merge with
   118 errors. (CP-F-05, WP-7.)

---

## Milestone: Post-v1.3.1 hardening — comprehensive engineering audit and TypeScript downgrade

A comprehensive engineering audit (2026-10-09, external, strictly
read-only) and a follow-up local read-only reconciliation session
re-verified the repository against the live tree. This section
consolidates the results: a findings register with stable IDs, the
reconciliation of every historical finding, the documentation drift
register, the owner decision register, and the work-package roadmap.
Audit trail: the audit deliverable is embedded here; no separate audit
document exists in the repository.

### Commits since the previous snapshot (`4ff04af`, 2026-10-05)

| Commit    | Subject                                                             | Evidence notes                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `7fe1e1e` | `fix(worker): wire subscription health writes into webhook.process` | 4 files: worker bootstrap +6 lines, `webhook-process-service.ts` +63, two test files +205. Resolves the health-writes half of the prior wiring-gap pending item. Worker suite grew 111 → 113 tests. (CONFIRMED via `git show --stat`; wiring CONFIRMED in `apps/worker/src/index.ts:107,213`.)                                                                                                                                                        |
| `28ffa40` | `chore(tooling): downgrade typescript to 5.9.3`                     | Exactly 9 files (7 package.json + `pnpm-workspace.yaml` + `pnpm-lock.yaml`; see Toolchain). Resolves pending item #2.                                                                                                                                                                                                                                                                                                                                 |
| `83a5e9e` | `docs(tooling): add TypeScript downgrade runbook`                   | Runbook at `docs/operations/typescript-7-0-2-to-5-9-3-downgrade-runbook-content-platform.md`. Its validation matrix lists `pnpm test`, `pnpm build`, `pnpm format:check`, `pnpm install --frozen-lockfile`, CI lint re-enable, HANDOFF update, commit, PR, merge; as of this snapshot test and format:check are now PASS (executed 2026-10-09), build and frozen-lockfile install remain pending, the commit and push are done, PR/merge remain open. |

### Findings register

Status legend: **CONFIRMED** = verified against the checked-out
repository this session with file/line evidence. **RESOLVED** = closed
by repository evidence. **OPEN** = live defect or decision not yet
acted on. **PARTIALLY VERIFIED** = static evidence only; runtime
behavior not exercised.

| ID      | Sev                               | Status                                         | Finding and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------- | --------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CP-F-01 | High                              | CONFIRMED, OPEN (owner decision)               | The normative `DATABASE_SCHEMA_CONTRACT.md` v1.3.1 (Normative: Yes, Production-Ready) requires for a populated-v1.2 production upgrade (Path A): Compatibility Bridge (INVARIANT-05, §20), token-rotation dual-write (INVARIANT-17), Bridge upsert compare-and-abort (INVARIANT-18), §2.8 SHA-256 preservation digests (INVARIANT-19), session-level advisory lock for 0016 (INVARIANT-08/20, §20.2.3), immutable pre-migration baseline (INVARIANT-22), §20.2.9 session state machine, Hard Gates #1/#2 (§20.2.4). CONFIRMED present in contract text (lines 190–284, 3934). CONFIRMED absent from the implementation: migrations 0015–0018, `packages/database/scripts/backfill-webhook-endpoints.mjs`, and `db:migrate` = plain `drizzle-kit migrate` contain none of these mechanisms. HANDOFF (prior revision) documented this as a deliberate dev-DB-only simplification; the code as shipped cannot safely perform the contract's production upgrade. |
| CP-F-02 | High                              | CONFIRMED, fix direction NORMATIVE             | `interaction_responses.destination_id`: Drizzle schema `packages/database/src/schema/interaction/interaction-responses.ts:49-51` declares `.notNull()` + `onDelete: 'set null'`; applied migration `packages/database/migrations/0011_natural_orphan.sql:58` emits `ON DELETE set null`. Contract §5.41 (line 2081) specifies `FK → destinations.id ON DELETE RESTRICT`, with rationale (lines 2114-2116): "setting the column to NULL would violate its NOT NULL declaration." HANDOFF invariant 19 repeats RESTRICT. PostgreSQL accepts the contradictory DDL; any delete of a referenced destination fails at runtime. Blast radius: CONFIRMED by repo-wide search — the only `.delete(` in application code is `outbox-repository.ts:154`; no application path deletes destinations, so the defect is latent (manual SQL / future admin UI) today. The dev database (Neon) currently carries the defective FK.                                           |
| CP-F-03 | Medium                            | CONFIRMED, OPEN                                | No advisory locking anywhere in the migration path: `packages/database/package.json` (`db:migrate` = `drizzle-kit migrate`, one transaction per migration), no lock in the backfill script, no custom runner, no CI migration step. Concurrent operators/deployments can race the backfill (duplicate `webhook_endpoints` rows) or the migration journal. The absence of locking is CONFIRMED; an actual harmful interleaving was not reproduced (not attempted, read-only session).                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| CP-F-04 | Medium                            | CONFIRMED, fix SPECIFIED (WP-6, unimplemented) | `eslint.config.js:27` uses `projectService: true` with no `allowDefaultProject` and no scripts tsconfig. All 14 operational `.mjs` scripts (13 × `packages/database/scripts/`, 1 × `apps/worker/scripts/inspect-bullmq.mjs`; CONFIRMED by glob) produce fatal "file not found" parse errors under the project service. Reproduced at HEAD: exactly 14 fatal messages across 14 files. Configuration defect, not source defects.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| CP-F-05 | Medium                            | CONFIRMED, OPEN                                | `.github/workflows/ci.yml` runs install → format:check → typecheck → test. Lint and build are absent. The header comment (lines 12-19) claims a TS 7.0.2 pin and typescript-eslint incompatibility — factually obsolete post-downgrade. Job name says "Build, typecheck, test" but no build step exists (build runs only as `postinstall`). The runbook (§7) explicitly recommends re-enabling lint only after the quality gate is green.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| CP-F-06 | Low                               | CONFIRMED, scope enlarged (see CP-F-15)        | `README.md:8` badge `typescript-7.0` (actual 5.9.3); `README.md:9` badge `tests-251 passing` (unverified and wrong: 251 was a total test count, not a pass count; at HEAD the totals are 172 passed / 98 skipped / 270 with DB env unset); `HANDOFF.md` (prior revision) header cited last commit `4ff04af` (actual `83a5e9e`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| CP-F-07 | Medium                            | CONFIRMED, refined by source triage            | Four genuine (non-config, non-convention) lint findings — but only one is production code: `preserve-caught-error` at `apps/worker/src/config.ts:89` (re-wrapped error loses `cause`). The other three are test-file findings: `no-base-to-string` at `apps/worker/src/interaction-response/meta-graph-bridge.test.ts:27`; `no-floating-promises` at `apps/worker/src/webhook/webhook-process-service-policy.test.ts:196`; `no-unsafe-return` at `packages/database/src/repositories/outbox-repository.test.ts:128`. The remaining 134 messages are: 14 config fatals (CP-F-04), 82 `require-await` (73 test mocks + 9 interface-preserving implementations such as the Fastify plugin contract at `meta.ts:32` and scheduler `stop()` methods), 6 `no-unused-vars` (mostly tests), 6 auto-fixable `consistent-type-imports`, 6 auto-fixable `no-unnecessary-type-assertion`, plus 20 warnings (15 `explicit-function-return-type`, 5 `no-console`).         |
| CP-F-08 | Medium                            | CONFIRMED, OPEN                                | DB/Redis-backed tests self-skip via `describe.skipIf(!TEST_..._URL)`. Observed 2026-10-09: 98 of 270 tests skipped without env vars, including the whole `packages/database` and `apps/api` suites. CI passes `TEST_DATABASE_URL`/`TEST_REDIS_URL` secrets; whether CI runs actually execute the gated suites was NOT inspected this session (no GitHub Actions access) — PARTIALLY VERIFIED.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| CP-F-09 | Low (dev) / High (populated prod) | CONFIRMED, OPEN                                | `0017_webhook_endpoints_contract.sql` builds the new unique index with plain `CREATE UNIQUE INDEX` (correctly non-concurrent, since drizzle-kit wraps each migration in one transaction) and uses ACCESS EXCLUSIVE `SET NOT NULL`. Fine for dev; must be re-evaluated in any production protocol. Folds into CP-F-01/WP-2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| CP-F-10 | Low                               | CONFIRMED, OPEN                                | Backfill ordering is procedural: an operator must run `backfill-webhook-endpoints.mjs` between 0016 and 0017; `drizzle-kit migrate` never invokes it. 0017's DO-block NULL check is a genuine, confirmed guard against un-backfilled rows. Folds into WP-2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| CP-F-11 | Info                              | RESOLVED                                       | The uploaded ESLint report's applicability to HEAD: the lint baseline was regenerated at HEAD `83a5e9e` and matches the report exactly — 209 files, 118 errors + 20 warnings = 138 messages, 14 fatals, identical per-rule histogram. Report-to-HEAD linkage CONFIRMED.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| CP-F-12 | Low                               | NEW, CONFIRMED, OPEN (contract amendment)      | Contract §5.41 status vocabulary (contract lines 2098-2112, 10 statuses, labeled "complete, aligned with §9.3") contradicts §56.1 and the implemented CHECK (`interaction-responses.ts:67-70`, `0011:14`): the schema enforces 15 statuses, adding `EDITED`, `QUEUED`, `IN_PROGRESS`, `RETRY`, `UNKNOWN`, `RECONCILIATION`. The schema/§56.1 side is the correct one (reconciliation states are mandatory elsewhere in the contract); §5.41 needs a contract amendment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| CP-F-13 | Low                               | NEW, CONFIRMED, OPEN                           | `interaction-responses.ts:40` doc-comment cross-references `DATABASE_SCHEMA_CONTRACT.md §5.39, §9.3`; §5.39 is `external_interactions`. The `interaction_responses` section is §5.41 (contract line 2073). One-line doc fix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| CP-F-14 | Low                               | NEW, CONFIRMED, OPEN                           | The prior HANDOFF revision documented the GET handshake as dual-read (endpoint-first, subscription fallback). The current code is endpoint-only: `apps/api/src/routes/webhooks/meta.ts:114-117` states the legacy subscription-scoped path was removed after migration 0017, and the handler decrypts only `webhook_endpoints` rows with AAD `META:WEBHOOK_VERIFY_TOKEN:<endpoint_id>` (`meta.ts:128-155`). The dual-read existed during the migration window (commit `cb9fcee`); HANDOFF described it as current past its removal. Doc-side drift; the GET contract (`hub.mode`/`verify_token`/`challenge`, 200 plaintext challenge, 403 on mismatch) is unchanged.                                                                                                                                                                                                                                                                                         |
| CP-F-15 | Low                               | NEW, CONFIRMED, OPEN                           | Count/version staleness beyond CP-F-06: repository classes = **19** files (prior HANDOFF said 16 exported; README says 15 — both stale; the three newer classes are `SystemConfigRepository`, `NotificationsRepository`, `SystemLogsRepository`). Tables = **45** (README structure block says 44). Migrations = **19** (`0000`–`0018`; README says 15). Tests = **270** total (prior HANDOFF said 268; README badge 251). Prior HANDOFF toolchain section said TS 7.0.2; pending item #2 and the "TypeScript 7 + ESLint" trap are obsolete; TECHNICAL_SPECIFICATION.md v0.9.0 header says "Language: TypeScript 7.0" (stale).                                                                                                                                                                                                                                                                                                                               |

---

### Material corrections to earlier audits (recorded explicitly)

1. **Audit inventory path correction:** the external audit referenced
   migrations under `packages/database/drizzle/`; the actual path is
   `packages/database/migrations/` with the journal at
   `packages/database/migrations/meta/_journal.json` (19 entries,
   `0000`–`0018`, all `breakpoints: true`; CONFIRMED by direct read).
2. **CP-F-02 reframed:** the external audit presented the
   `destination_id` referential action as an unresolved owner choice
   (nullable vs RESTRICT vs CASCADE). The contract already decides:
   §5.41 mandates NOT NULL + ON DELETE RESTRICT with explicit
   rationale, and HANDOFF invariant 19 repeats it. What remains is
   owner **sign-off** on the corrective implementation (WP-1), not a
   design decision.
3. **CP-F-07 refined:** three of the four "genuine" lint findings are
   in test files; only `apps/worker/src/config.ts:89` is production
   code. This narrows WP-3 substantially and couples most of the
   cleanup to the WP-8 test-scoping policy.
4. **Test-count drift:** the historical "172 passed / 93 skipped"
   figure — its passed half is CONFIRMED at HEAD (172), but skipped is
   now 98 (`7fe1e1e` added DB-gated tests). The README "251 passing"
   badge is doubly wrong (wrong then as a label, stale now as a
   number).
5. **Handshake description (CP-F-14)** and **doc counts (CP-F-15)** as
   registered above.
6. **WP-6 mechanism correction:** the external audit's primary
   suggestion (`projectService.allowDefaultProject` for the 14 script
   globs) is not viable — the installed `typescript-estree@8.70.0`
   hard-caps default-project matches at 8 files
   (`Too many files (>8) have matched the default project`; the
   documented override is literally named
   `maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING`).
   CONFIRMED in the installed package sources this session. The audit's
   sanctioned alternative (dedicated scripts tsconfig) is the correct
   route; specified in WP-6 below.
7. **`drizzle-kit check` scope:** the PASS result recorded above
   covers journal/snapshot consistency only. It is not evidence of
   conformance to the contract's migration governance; CP-F-01 stands.
8. **CI state:** the external audit reported "no open or closed PRs"
   for this branch — re-confirmed locally is impossible (no GitHub
   access this session); retained as UNVERIFIED-but-uncontradicted,
   last verified 2026-10-09 by the external audit over HTTP.

### Historical findings F1–F7, AT-01 — reconciliation (2026-10-09)

All were verified by **static source inspection** this session
(read-only). None was re-exercised at runtime; runtime/E2E
re-verification remains WP-5.

| ID                                                     | Status                        | Evidence                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 webhook ingress transaction boundary                | **VERIFIED CLOSED (static)**  | `apps/api/src/routes/webhooks/meta.ts:45-108`: raw-body → HMAC-SHA256 verify (fail-closed 401) → JSON parse → Zod envelope → single `txManager.run()` (lines 76-103) containing destination lookup, idempotent `webhook_events` insert, and conditional `outbox_jobs` enqueue; HTTP 200 after commit. Exactly the documented boundary; no Redis on the hot path.                      |
| F2 interaction-response config from `system_config`    | **VERIFIED CLOSED (static)**  | `apps/worker/src/index.ts:116,131-157` + `apps/worker/src/credentials/runtime-config-loader.ts`: rules, templates, and rate limits load from `system_config` with fail-closed defaults and logged defaulted keys. Seed migration `0013_seed_system_config.sql` present.                                                                                                               |
| F3/F4 Redis-backed Meta rate limiters on both adapters | **VERIFIED CLOSED (static)**  | One `RedisMetaRateLimiter` (`index.ts:177`) constructed with dedicated Redis connection (92-99) and injected into both `MetaInteractionAdapter` (line 239) and `MetaPublisherAdapter` (line 244). `RedisMetaRateLimiter implements MetaRateLimiter, MetaPublishRateLimiter` (`redis-meta-rate-limiter.ts:127`). Enforcement at runtime not traced — PARTIALLY VERIFIED beyond wiring. |
| F5 DB-backed credentials in worker outbound paths      | **VERIFIED CLOSED (static)**  | `index.ts:161-173`: `MetaCredentialService` is mandatory at boot (worker refuses to start without it); `buildGetAccessToken` bridge feeds both adapters. Credential-consumption runtime paths not traced — PARTIALLY VERIFIED beyond wiring.                                                                                                                                          |
| F6 scheduler credential-health gate                    | **VERIFIED CLOSED (static)**  | `apps/worker/src/publication/publication-scheduler-service.ts:79` calls `credentialService.healthCheck(destinationId)`; scheduler receives the service at `index.ts:379`. Gate semantics (INVALID → FAILED) per the service implementation and its 17 tests (DB-gated).                                                                                                               |
| F7 outbox system operations, rebuild, cleanup          | **VERIFIED CLOSED (static)**  | `apps/worker/src/index.ts:184` (dispatcher), 404-459 (rebuild service/worker, cleanup service/worker, hourly cleanup scheduler). `outbox_jobs.job_id` UNIQUE idempotency anchor enforced at schema level (INVARIANT-27 in this document; `outbox-jobs.ts`).                                                                                                                           |
| AT-01 audit-trail completeness                         | **RESOLVED by design record** | `audit_logs` has no writer by a documented deferred decision (admin-UI milestone; Sprint C record below). `system_logs` and `notifications` writers are wired (`index.ts:122-127`). "Mapping validation" aspects of AT-01 were never precisely defined; retained as an evidence gap, not a defect.                                                                                    |

**Still open from the wiring-gap pending item:**
`InteractionModerationActionsRepository` is CONFIRMED absent from
`apps/worker/src/index.ts` (its import list, lines 2-20, does not
include it; repo-wide grep finds no worker usage). Interaction
moderation decisions are not persisted to
`interaction_moderation_actions`. The repository implementation and
its tests exist. The `webhook_subscription_health` half was resolved by
`7fe1e1e` (`webhook-process-service.ts` now takes
`subscriptionHealthRepo`, wired at `index.ts:107,213`).

---

### Documentation and specification drift register (WP-9 input)

CONFIRMED by direct read on 2026-10-09:

- `README.md`: badges `typescript-7.0` (line 8) and `tests-251
passing` (line 9); structure block "44 tables" / "15 repository
  classes" / "migrations 0000 - 0014"; documentation map cites
  "DATABASE_SCHEMA_CONTRACT.md v1.2"; "Project status" says v1.3 is
  "Next"; workspace table totals 251. All stale (correct values: TS
  5.9.3; 172 passed/98 skipped/270 total; 45 tables; 19 repository
  classes; 19 migrations; contract v1.3.1; v1.3.1 complete).
- `HANDOFF.md` (prior revision): header commit/date; toolchain TS
  7.0.2; pending item #2 (downgrade) — now RESOLVED; "TypeScript 7 +
  ESLint compatibility" trap — obsolete; handshake dual-read paragraph
  — superseded (CP-F-14); workspace/test/repo counts (CP-F-15);
  pending item #5 (LOGICAL spec status) — now RESOLVED.
- `docs/architecture/TECHNICAL_SPECIFICATION.md` v0.9.0: header says
  "Language: TypeScript 7.0"; body aligned to DB contract v1.2 (44
  tables). Supersessions of §136 et al. are recorded in the contract
  header (contract lines 48-56) and in this document's
  source-of-truth hierarchy.
- `docs/architecture/LOGICAL_MODEL_SPECIFICATION.md`: **v1.0, Status
  Final** — presence and status CONFIRMED (resolves prior pending
  item #5). No supersession indicators.
- `docs/architecture/META_INTEGRATION_SPECIFICATION.md` v1.4:
  baseline DB v1.2; contract header explicitly supersedes its §5 and
  §48; HANDOFF's drift list (§9.8, §36, §52, §2.2) remains the
  reconciliation input.
- `docs/architecture/DATABASE_SCHEMA_CONTRACT.md` v1.3.1: Normative,
  Production-Ready, self-contained; internal inconsistency at §5.41
  status vocabulary (CP-F-12) is the one confirmed defect _inside_ the
  contract.
- `.github/workflows/ci.yml`: header comment obsolete (CP-F-05).
- `packages/database/src/schema/interaction/interaction-responses.ts`:
  §5.39 cross-reference error (CP-F-13).

### Owner decision register (genuinely open; not decidable from the repository)

1. **CP-F-01 — Path A:** implement the full §20 four-phase protocol
   (Bridge deployment, Hard Gates #1/#2, advisory-lock single-session
   runner, immutable baseline + §2.8 digests, §20.2.9 state machine),
   or formally amend the contract to a documented dev-only scope with
   a separately-defined production protocol later. **No default is
   recorded here; this is the owner's call.** Blocks WP-2 and all
   production-upgrade eligibility. The do-not-run condition at the top
   of this document binds until this decision is made and the chosen
   implementation is verified against the contract.
2. **CP-F-02 — sign-off, not design:** the contract already mandates
   RESTRICT. Owner sign-off is requested for WP-1 (schema change +
   migration 0019) because it is a DDL change to a table with business
   data, not because the target state is undecided.
3. **WP-8 policy:** approve config-scoped lint-rule relaxation for
   `**/*.test.ts` (`require-await` and, per triage, the three
   test-file findings in CP-F-07). Constraint: never strip `async`
   from throwing mocks (changes rejection timing); never disable rules
   globally to go green.
4. **Merge strategy (Q10):** merge `chore/downgrade-typescript-5.9.3`
   into `main` now, or after the lint chain (WP-6/3/8/7) lands. The
   branch is toolchain-consistent and `main` has no lint gate either
   way; merging is low-risk but remains an owner call.

---

### Work packages (dependency-aware roadmap; nothing below is implemented)

Status values: **PROPOSED** (not started; this document is the spec),
**GATED** (blocked by a decision or prerequisite).

| WP   | Addresses                         | Status                      | Dependencies                                 | Outline, acceptance, risk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | --------------------------------- | --------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WP-6 | CP-F-04                           | PROPOSED, recommended first | none                                         | Add `packages/database/scripts/tsconfig.json` and `apps/worker/scripts/tsconfig.json` (identical minimal content: `target ES2022`, `module ESNext`, `moduleResolution Bundler`, `allowJs: true`, `checkJs: false`, `strict: true`, `noEmit: true`, `skipLibCheck: true`, `include: ["./**/*.mjs"]`). The project service auto-discovers them; `@types/node` already resolves in both packages (both declare `@types/node ^22`; CONFIRMED present in each package's `node_modules/@types`). No dependency or lockfile change; builds unaffected (no tsconfig references the scripts projects). Add one scoped block to `eslint.config.js` for `files: ['**/*.mjs']` setting `'no-undef': 'off'` with justification (type-aware linting + Node globals resolved by TS; mirrors typescript-eslint's own `eslint-recommended` rationale). **Do not** use `allowDefaultProject` (8-file hard cap, correction #6 above). Acceptance: `pnpm lint` shows 0 fatal parse errors; error count drops by exactly 14 modulo drift; typed rules still load for TS sources; format/typecheck/tests unchanged green. Risk: minimal — config-only, no runtime or dependency changes. Unimplemented and unverified as of this snapshot. |
| WP-3 | CP-F-07 (production item)         | PROPOSED                    | none                                         | One-line-class fix at `apps/worker/src/config.ts:89`: attach `cause` to the re-wrapped error so the root cause is preserved. Classified by source inspection: the other three CP-F-07 findings are test-file findings and belong to WP-8's policy. Acceptance: finding closed with a unit test if the path is observable; lint count for production-code findings reaches 0 or carries an explicit waiver. Risk: minimal. Unimplemented.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| WP-8 | test lint noise + 3 test findings | GATED (policy approval #3)  | none technically                             | Scope `require-await` (73 test occurrences) and triage the three test-file findings (`meta-graph-bridge.test.ts:27`, `webhook-process-service-policy.test.ts:196`, `outbox-repository.test.ts:128`) via config for `**/*.test.ts` or targeted fixes. Acceptance: lint green on tests without behavioral test edits; documented justification. Risk: low if config-scoped; medium if any `async` is stripped from throwing mocks. Unimplemented.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| WP-7 | CP-F-05                           | GATED                       | WP-6, WP-3, WP-8 decision                    | Add `pnpm lint` and an explicit `pnpm build` step to CI; delete the obsolete header comment (lines 12-19). Matches the runbook §7 sequence. Acceptance: green CI on a clean tree at the enforced quality gate. Risk: enabling lint before WP-6/3/8 blocks all merges (118 errors). Unimplemented.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| WP-1 | CP-F-02                           | GATED (owner sign-off #2)   | none technically; dev-DB backup before apply | Change `interaction-responses.ts:51` to `onDelete: 'restrict'`; generate migration 0019 via `drizzle-kit generate` (DROP/ADD of the destination FK constraint); contract §5.41 text is already correct — no contract change beyond the unrelated CP-F-12; add a repository/service test asserting that deleting a referenced destination is rejected and that schema/migration parity holds (`drizzle-kit generate` prints "No schema changes"). Apply to the dev database only, after backup, and **never** against a populated production database within the CP-F-01 do-not-run condition. The corrective migration is **proposed, unimplemented, and unverified**. Acceptance: schema, migration 0019, contract §5.41, and tests agree; typecheck/lint/tests green. Risk: low on dev (no app code deletes destinations — CONFIRMED); FK action change would surface only in paths that attempt destination deletion.                                                                                                                                                                                                                                                                                             |
| WP-9 | CP-F-06/12/13/14/15               | PROPOSED                    | none; coordinate with WP-7 for ci.yml        | Refresh README (badges, 45 tables, 19 repos, 19 migrations, contract v1.3.1, test counts or a CI-generated badge); refresh this document's stale sections (done by this revision); contract §5.41 vocabulary amendment (CP-F-12); `interaction-responses.ts` cross-ref fix (CP-F-13); TECH spec header (TypeScript 7.0 → 5.9.3) and v1.3.1 compatibility notes; META spec supersession notes; CI-generated lint/test artifacts carrying commit SHAs. Acceptance: docs match HEAD; future reports are revision-bound. Risk: documentation-only. Unimplemented.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| WP-4 | CP-F-08                           | PROPOSED                    | none                                         | Add Postgres + Redis service containers to a separate CI job so the 98 skipped tests execute on PRs against ephemeral instances only. The 13 TRUNCATE-based test files (CONFIRMED by grep) make shared/production databases absolutely off-limits. Provide `TEST_DATABASE_URL`/`TEST_REDIS_URL` pointed at the services. Acceptance: CI logs show the gated suites executed and passing. Risk: CI-only; test isolation configuration errors could flake — mitigate with service containers scoped to the job. Unimplemented.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| WP-5 | remaining runtime evidence        | PROPOSED                    | none                                         | Re-run the real E2E verifications (inbound webhook POST → materialization; outbound publication) against the current HEAD, trace the runtime paths only statically verified above (F3/F4/F5 enforcement, outbox/BullMQ idempotency interplay), and re-run the DB-gated suites against an ephemeral database with env vars set. Records results as new evidence; no defect is presumed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| WP-2 | CP-F-01/03/09/10                  | GATED (owner decision #1)   | decision #1; then substantial design         | Only after the owner decides "implement §20": advisory-lock single-session runner (`pg_advisory_lock` fixed key, pinned connection per INVARIANT-20/08), immutable pre-migration baseline + §2.8 canonical-JSON SHA-256 digests, Compatibility Bridge with compare-and-abort upserts, executable Hard Gates #1/#2, production index strategy, and a rehearsal on a restored production-shaped copy with digest verification and concurrent-runner tests. If the owner decides "amend contract", WP-2 becomes the contract-amendment work plus a separately-scoped future production protocol. **No production migration until this WP completes and passes rehearsal.** Unimplemented.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### Release gates (summary)

| Action                           | Gate                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| lint/typecheck/format/unit tests | none beyond a clean install                                                                        |
| DB integration tests             | `TEST_DATABASE_URL` pointing at an **ephemeral** DB only (tests TRUNCATE); never shared/production |
| Redis integration tests          | `TEST_REDIS_URL` ephemeral, isolated DB/prefix                                                     |
| migration execution (dev)        | recreatable dev DB; backfill ordering 0016 → backfill → 0017                                       |
| migration execution (production) | **PROHIBITED** until WP-2 completes with rehearsal + explicit human authorization                  |
| provider tests                   | Meta sandbox credentials only; live mutations need explicit authorization                          |
| production deployment            | owner decisions #1-#2 resolved; P1 work merged; staged rollout                                     |

---

## Milestone: v1.3.1 contract completion

The `DATABASE_SCHEMA_CONTRACT.md` v1.3.1 is now **FINAL** and the DB
has been migrated to the v1.3.1 target state. This milestone covers the
two aggregate-boundary changes (D-013 `webhook_endpoints`, D-016
provider-aware natural key), the AAD-form correction in the Meta setup
runbook, and the completion migration (`0018`) that closes the schema
target state.

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
handshake used endpoint-first verification with subscription fallback
during the migration window (commit `cb9fcee`) — the fallback path was
removed from the code after migration 0017 (current code:
`meta.ts:114-117`, endpoint-only; see CP-F-14).

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
`DATABASE_SCHEMA_CONTRACT.md` v1.3.1 §20. This remains true as of the
2026-10-09 re-verification (CP-F-01); the decision whether to implement
§20 or amend the contract is open with the owner.

### Verified target state

The `drizzle.__drizzle_migrations` table contains 19 rows (`0000`–`0018`).
The `_journal.json` contains 19 entries. Both are in sync.
(Re-verified at repository level on 2026-10-09: journal at
`packages/database/migrations/meta/_journal.json`, 19 entries.)

Verified after migration (2026-10-05, against Neon):

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
  test counts. (Superseded: as of 2026-10-09 the README counts are
  again stale — see the drift register, WP-9.)

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
`webhook_subscriptions.id` above has a corresponding
`webhook_endpoints.id` in the migrated dev database; the token rotation
and endpoint-upsert rules from `DATABASE_SCHEMA_CONTRACT.md` v1.3.1
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

Six workspace packages (270 tests total; per-package figures are
2026-10-09 measurements with DB/Redis env unset — "skipped" tests are
the DB/Redis-gated suites that self-skip without the env vars):

| Package                         | Purpose                                                                                                               | Tests (passed/skipped)    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `packages/database`             | Drizzle schema, migrations, repositories, TransactionManager                                                          | 0 / 28 (28, all DB-gated) |
| `packages/authentication`       | AES-256-GCM, MetaCredentialService, Graph API client                                                                  | 24 / 13 (37)              |
| `packages/interaction-response` | Policy engine, template renderer (pure, deterministic)                                                                | 26 / 0 (26)               |
| `packages/publishers`           | MetaInteractionAdapter, MetaPublisherAdapter, MetaResponseReconciler, MetaPublicationReconciler, RedisMetaRateLimiter | 51 / 5 (56)               |
| `apps/worker`                   | OutboxDispatcher, publication scheduler, interaction response scheduler, system queues, observability services        | 71 / 42 (113)             |
| `apps/api`                      | Fastify webhook ingress (POST + GET), handshake                                                                       | 0 / 10 (10, DB-gated)     |
| **Total**                       |                                                                                                                       | **172 / 98 (270)**        |

Test file count: 31 across the six packages (matches the ESLint
baseline file count). The 172-passed figure matches the historical
"172 passed" record; the historical "93 skipped" has drifted to 98
because `7fe1e1e` added DB-gated tests. With `TEST_DATABASE_URL` and
`TEST_REDIS_URL` set, the gated suites run against those databases;
without them, the suites silently skip (see the skipIf trap below).

### Database schema — v1.3.1 target state

- **45 tables** implementing DB v1.3.1. (45 `pgTable(` declarations
  across 44 schema files; one file declares two tables.)
- **19 migrations** (`0000` – `0018`), applied to Neon PostgreSQL;
  journal at `packages/database/migrations/meta/_journal.json`
  (the migration directory is `packages/database/migrations/`).
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
- **Known deviation (CP-F-02, OPEN):** `interaction_responses.
destination_id` carries `ON DELETE SET NULL` (schema line 51,
  migration 0011 line 58) where contract §5.41 mandates `ON DELETE
RESTRICT`. No application code deletes destinations; the defect is
  latent. Corrective migration proposed in WP-1 — unimplemented.

### Repositories implemented

There are **19 repository classes** in
`packages/database/src/repositories/` (the prior "16" and README's
"15" are stale — CP-F-15).

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

#### Platform / observability

- `SystemConfigRepository` — typed `system_config` reads.
- `NotificationsRepository`.
- `SystemLogsRepository`.

All repository integration tests with a database dependency run
against Neon PostgreSQL when `TEST_DATABASE_URL` is configured.

**Wiring status (updated 2026-10-09).** `WebhookSubscriptionHealth`
writes are **wired** into `webhook.process` since `7fe1e1e`
(`apps/worker/src/index.ts:107,213`). `InteractionModerationActions`
remains **unwired**: moderation decisions are not persisted to
`interaction_moderation_actions`. Both repository implementations
exist and are tested in isolation.

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
- `WebhookProcessService` — parse and materialize webhook events;
  writes `webhook_subscription_health`.
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
  atomic claim + outbox enqueue per scan; credential-health gate.
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

The `GET /api/v1/webhooks/meta` handshake is **endpoint-only** since
migration 0017 (`apps/api/src/routes/webhooks/meta.ts:114-117`):

1. `hub.mode` must be `subscribe`; `hub.verify_token` and
   `hub.challenge` are required.
2. All `webhook_endpoints` rows where `provider = 'META' AND status =
'ACTIVE'` are loaded and decrypted with AAD
   `META:WEBHOOK_VERIFY_TOKEN:<endpoint_id>`.
3. Ciphertext format is `v1:base64(iv ‖ ciphertext ‖ tag)` using
   AES-256-GCM.
4. On match, `last_verified_at` is updated on the matched endpoint and
   `hub.challenge` is returned as plain text.
5. On mismatch, HTTP 403 is returned.

The dual-read fallback (subscription-scoped decryption, commit
`cb9fcee`) existed during the migration window and was removed after
0017 dropped the subscription token columns. The prior HANDOFF
revision still described the dual-read as current (corrected here;
CP-F-14).

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
| GET    | `/api/v1/webhooks/meta` | Meta `hub.challenge` handshake (endpoint-only)     |

There is **no user authentication/authorization** anywhere in
`apps/api` (CONFIRMED 2026-10-09: the only auth-related code is
webhook signature verification and token decryption). This is
consistent with the current scope (webhook ingress + health probes;
the admin UI does not exist yet). It must be revisited before any
mutating operator-facing API is added. This answers the historical
Q8-style concern as: intentional today, not a certified boundary.

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

- Node.js **22.x** (pinned in `.nvmrc`; v22.21.0 observed 2026-10-09).
- pnpm **12.3.4** (pinned via `packageManager`).
- TypeScript **5.9.3** (pinned in `package.json` and
  `pnpm-workspace.yaml`; downgraded from 7.0.2 by `28ffa40`).
- Drizzle ORM **0.45.2**, Drizzle Kit **0.31.10**.
- BullMQ **5.34.0**, ioredis **5.4.2**.
- Fastify **5.2.0**, Zod **3.24.1**.
- Vitest **5.0.0**.
- ESLint **10.10.0**, Prettier **3.9.6**, typescript-eslint **8.70.0**.

**CI (`.github/workflows/ci.yml`):** install (frozen lockfile) →
format:check → typecheck → test; `permissions: contents: read`;
concurrency cancel; Node via `.nvmrc`; `TEST_DATABASE_URL` /
`TEST_REDIS_URL` from secrets. **Lint and build steps are absent**
(CP-F-05); the header comment (lines 12-19) still claims the obsolete
TS 7.0.2/typescript-eslint incompatibility. The lint step is to be
re-enabled only per the WP-6 → WP-3 → WP-8 → WP-7 sequence.

**Lint baseline at HEAD (regenerated 2026-10-09):** 138 messages =
118 errors + 20 warnings across 209 files; 14 are fatal parse errors
on the `.mjs` operational scripts (CP-F-04, configuration defect);
exactly one genuine production-code finding
(`preserve-caught-error`, `apps/worker/src/config.ts:89`); the rest are
test-file findings (three), test-mock `require-await` (73),
interface-preserving `require-await` (9), auto-fixables (12), unused
vars (6), and warnings (20). The full baseline is reproducible with
`pnpm lint`.

### Documentation

- `README.md` — stale in badges, counts, and versions (drift register
  above; WP-9).
- `HANDOFF.md` — this file.
- `docs/README.md`
- `docs/adr/` — Architecture Decision Records.
- `docs/architecture/README.md`
- `docs/architecture/system-overview.md` — stale per drift register
  (44-table era; WP-9).
- `docs/architecture/domain-model.md` — stale per drift register.
- `docs/architecture/data-model.md` — stale per drift register.
- `docs/architecture/TECHNICAL_SPECIFICATION.md` — v0.9.0; header
  claims "TypeScript 7.0"; supersessions recorded in the contract
  header (§136 et al.).
- `docs/architecture/DATABASE_SCHEMA_CONTRACT.md` — **v1.3.1 final**;
  one internal inconsistency (CP-F-12).
- `docs/architecture/LOGICAL_MODEL_SPECIFICATION.md` — **v1.0, Status
  Final** (presence and status confirmed 2026-10-09).
- `docs/architecture/META_INTEGRATION_SPECIFICATION.md` — v1.4,
  baseline DB v1.2; partially superseded by v1.3.1 (§5, §48 per the
  contract header; §9.8, §36, §52, §2.2 per the drift register).
- `docs/conventions/`
- `docs/operations/README.md`
- `docs/operations/local-development.md` — stale per drift register.
- `docs/operations/meta-app-setup.md`
- `docs/operations/typescript-7-0-2-to-5-9-3-downgrade-runbook-content-platform.md`
  — the downgrade runbook (validation matrix partially outdated:
  test/format:check now PASS per this snapshot).
- `docs/planning/v1-3-development-plan-2026-10-04.md` — superseded
  by the v1.3.1 contract.
- `docs/audit/baseline-audit-2026-09-20.md`
- `docs/audit/sprint-audit-2026-10-03.md`
- `docs/audit/v1-3-readiness-audit-2026-10-04.md` (+ its work order)

---

## Pending items

### 1. Wiring gaps (revised 2026-10-09)

- `WebhookSubscriptionHealth` — **RESOLVED** by `7fe1e1e`: health
  rows are written from `webhook.process`
  (`apps/worker/src/index.ts:107,213`;
  `webhook-process-service.ts`).
- `InteractionModerationActions` — **OPEN**: the repository exists
  and is tested, but it is not wired into the worker bootstrap
  (confirmed absent from `apps/worker/src/index.ts`), so moderation
  decisions are not persisted to `interaction_moderation_actions`.
  Targeted fix: wire into `WebhookRespondService` (or
  `InteractionResponseService`).

### 2. TypeScript downgrade for ESLint compatibility — RESOLVED

Resolved by `28ffa40` + `83a5e9e`: TypeScript 5.9.3 everywhere,
typescript-eslint 8.70.0 operational, typecheck and unit-test gates
green at HEAD (2026-10-09). Remaining from the runbook's validation
matrix: `pnpm build` and `pnpm install --frozen-lockfile` were not
re-executed this session (read-only constraints) and remain formally
pending; CI lint re-enable is WP-7; PR/merge is owner decision #4.

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

### 5. `LOGICAL_MODEL_SPECIFICATION.md` status — RESOLVED

`docs/architecture/LOGICAL_MODEL_SPECIFICATION.md` is present, v1.0,
Status Final (confirmed 2026-10-09). No supersession indicators.

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

### 8. Documentation drift reconciliation — EXPANDED

Concrete items (all CONFIRMED 2026-10-09; full register in the
findings section):

- `README.md`: badges (`typescript-7.0`, `tests-251 passing`),
  structure counts (44 tables / 15 repos / 15 migrations),
  documentation map (contract v1.2), project status (v1.3 as Next),
  workspace table (251).
- `HANDOFF.md` prior revision: header, toolchain, pending #2, TS7
  trap, handshake paragraph, counts — all corrected by this revision.
- `DATABASE_SCHEMA_CONTRACT.md` §5.41: status vocabulary contradicts
  §56.1 and the schema (CP-F-12) — contract amendment.
- `interaction-responses.ts:40`: cross-reference §5.39 → §5.41
  (CP-F-13).
- `TECHNICAL_SPECIFICATION.md` v0.9.0: header "Language: TypeScript
  7.0"; v1.2 alignment (§136, §84 et al. superseded per the contract
  header).
- `META_INTEGRATION_SPECIFICATION.md` v1.4: §9.8, §36 Layer 2, §52,
  §2.2 (drift list from the v1.3.1 note).
- `docs/architecture/data-model.md`, `domain-model.md`, `README.md`,
  `system-overview.md`: 44→45 tables, missing `webhook_endpoints`,
  v1.2 natural key.
- `docs/adr/ADR-002-outbox-pattern.md` (BullMQ dedup overstatement),
  `docs/adr/ADR-005-health-separation.md` (section renumbers).
- `docs/operations/local-development.md` (migration count, test
  count, legacy encryption key format).
- `.github/workflows/ci.yml` header comment (CP-F-05).

The minimal reconciliation is a "v1.3.1 compatibility note" at the top
of each affected document that lists the superseded statements and
points to the corresponding v1.3.1 sections. The full §-level revision
can proceed in parallel or later.

---

## Next steps

### 0. Owner decisions (blocking)

1. CP-F-01: implement §20 Path A protocol vs formally amend the
   contract. (Blocks WP-2 and production-upgrade eligibility.)
2. CP-F-02: sign-off on WP-1 (contract-mandated RESTRICT correction).
3. WP-8: approve test-file lint-rule scoping policy.
4. Merge strategy for `chore/downgrade-typescript-5.9.3`.

### Primary: lint chain (WP-6 → WP-3 → WP-8 → WP-7)

1. WP-6: add the two scripts tsconfigs + the scoped `no-undef` block
   (specification in the findings register). Zero fatal parse errors;
   error count drops by exactly 14 modulo drift.
2. WP-3: attach `cause` at `apps/worker/src/config.ts:89`.
3. WP-8 (after policy approval): config-scope the test-file rules;
   triage the three test-file findings.
4. WP-7: add `pnpm lint` and `pnpm build` to CI; delete the obsolete
   header comment.

### Secondary: correctness and validation

5. WP-1: CP-F-02 corrective schema + migration 0019 (dev DB only,
   after backup; never production under the CP-F-01 do-not-run
   condition).
6. WP-4: CI Postgres/Redis service containers so the 98 skipped tests
   execute on PRs (ephemeral databases only — 13 test files TRUNCATE).
7. WP-5: runtime/E2E re-verification (real inbound webhook, real
   outbound publication, DB-gated suites on an ephemeral DB).

### Tertiary: documentation (WP-9)

Apply the drift register: README refresh, contract §5.41 amendment
(CP-F-12), cross-ref fix (CP-F-13), TECH/META compatibility notes,
CI-generated revision-bound lint/test artifacts.

### Quarterly: production Path A (WP-2)

Only after owner decision #1. If "implement": full §20 protocol
(Compatibility Bridge, Hard Gates #1/#2, advisory-lock runner,
preservation baseline + §2.8 digests, §20.2.9 state machine),
rehearsal on a restored production-shaped copy, concurrent-runner
testing, and explicit human authorization before any populated
database is touched. If "amend": contract amendment + separately
scoped future production protocol.

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
16. The App-level webhook verify token is owned by
    `webhook_endpoints`. No per-subscription duplication.
17. The target-state authoritative verify-token AAD is
    `META:WEBHOOK_VERIFY_TOKEN:<endpoint_id>`. The legacy
    destination-scoped AAD is migration-window-only.
18. The natural external identity of `external_interactions` is
    `(provider, external_interaction_id)`, enforced by a
    **UNIQUE INDEX** (`external_interactions_provider_external_id_uq`).
19. `interaction_responses.destination_id` is `NOT NULL` with
    `ON DELETE RESTRICT`. **Implementation deviation (CP-F-02, OPEN):**
    the current schema and migration 0011 carry `ON DELETE SET NULL`,
    which contradicts this invariant and the contract §5.41 rationale;
    every deletion of a referenced destination fails at runtime. The
    corrective change is specified in WP-1 (unimplemented). Until it
    lands, treat this invariant as violated-by-implementation and do
    not attempt destination deletions.
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

Invariants 24, 25, 26, 28, and 29 (this document's numbering;
contract [INVARIANT-08], [INVARIANT-14], [INVARIANT-19], [INVARIANT-20],
and [INVARIANT-22] respectively) are fully enforced only under the
§20 Path A protocol, which is unimplemented (CP-F-01). The
Compatibility Bridge requirement (contract [INVARIANT-05], §20) is
Path A-only as well; this document's invariant list does not restate
it. For the dev-DB path actually in the repository, the operative
safeguards are the idempotent backfill and 0017's DO-block guard.

---

## Known patterns and traps

These are lessons learned during Phases 14–19e, v1.3.1 finalization,
and the 2026-10-09 audit reconciliation. They are captured here so the
next session does not re-encounter them.

### `describe.skipIf(!TEST_DB_URL)` silently skips DB tests — and a green run is not integration evidence

The DB- and Redis-backed integration tests use the
`describe.skipIf(!TEST_DB_URL)` pattern. When the environment
variable is absent, the entire test file is skipped without any
warning in the standard test output.

The consequence: a default `pnpm test` run without
`TEST_DATABASE_URL` reports "green" while silently omitting 98 of 270
tests (measured 2026-10-09), including the whole `packages/database`
and `apps/api` suites. **Never cite a passing env-unset run as
evidence that the integration tests pass.** The CI pipeline provides
`TEST_DATABASE_URL` and `TEST_REDIS_URL` via repository secrets (CI
execution itself not re-inspected 2026-10-09); local developers must
export the env vars explicitly, pointed at disposable databases only.

When adding new integration tests, add the same pattern and remember
that a "passing" local run without the env vars does not exercise the
new tests.

### DB integration tests TRUNCATE — ephemeral databases only

13 test files issue `TRUNCATE ... RESTART IDENTITY CASCADE` fixtures
(CONFIRMED by grep on 2026-10-09), including
`apps/api/src/routes/webhooks/meta.test.ts`. These tests must never
run against a shared, staging, or production database. CI isolation
must use per-job service containers (WP-4).

### `drizzle-kit check` is not contract-conformance evidence

`drizzle-kit check` validates the migration journal/snapshot chain.
It says nothing about the v1.3.1 contract's §20 governance
requirements (Bridge, Hard Gates, advisory lock, baseline, digests).
A "check passes" result must never be cited against CP-F-01.

### typescript-eslint `allowDefaultProject` is capped at eight files

The installed typescript-eslint 8.70.0 hard-caps files matched into
the default project at 8 (`Too many files (>8) have matched the
default project`); the only override is a flag explicitly named
`maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING`.
For the 14 operational `.mjs` scripts, use dedicated per-directory
tsconfigs instead (WP-6). Do not reach for the cap override.

### A lint "fatal parse error" storm usually means project coverage, not source rot

The 14 fatal `.mjs` errors at HEAD are a single configuration gap:
`projectService: true` without any project covering the scripts
directories. Fix coverage (WP-6); do not "fix" the scripts, and do
not exclude the directories from linting.

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
and is **final** (presence, version, and status re-confirmed
2026-10-09; invariant 15 in this document).

The v1.3.1 contract explicitly supersedes statements in:

- `TECHNICAL_SPECIFICATION.md v0.9.0 §136` — `webhook_endpoints` and
  the provider-aware natural key are in scope for v1.3, not Post-MVP.
- `META_INTEGRATION_SPECIFICATION.md v1.4 §5` — `webhook_endpoints`
  is not an explicit non-goal.
- `META_INTEGRATION_SPECIFICATION.md v1.4 §48` — the provider-aware
  natural key is in scope, not future.

These supersessions are recorded in the contract header (contract
lines 48-56), which additionally directs that the higher-level
documents be revised to contract §5.34, §5.39, §5.35, and §23.4.

Additional drift in the higher-level documents — 44→45 tables, the
missing `webhook_endpoints`, the v1.2-era natural key, stale headers
and counts — is registered in the documentation drift register above
and is reconciled through WP-9 (compatibility notes first, §-level
revisions in parallel or later). Until that reconciliation lands,
this hierarchy — not the stale higher-level documents — adjudicates
any conflict about the physical persistence model.

---

## Document integrity note

**Provenance.** This revision of the handoff document was produced by
the 2026-10-09 comprehensive engineering audit (external, strictly
read-only) and the follow-up local read-only reconciliation session.
Every check cited in this document was executed against the
checked-out repository at HEAD `83a5e9e` on branch
`chore/downgrade-typescript-5.9.3`; no repository file, Git object,
GitHub state, database, or Redis instance was modified at any point.
The only write target for the audit and reconciliation outputs is
this file, outside the repository.

**Required-section verification (executed at completion of this
note, 2026-10-10):**

- Findings register CP-F-01 through CP-F-15 — all 15 present, each
  with severity, status, and file/line evidence.
- Work packages WP-1 through WP-9 — all 9 present in the
  dependency-aware roadmap table.
- Architectural invariants — all 30 present, numbered 1-30, with the
  Path A enforcement caveat recorded after invariant 30.
- Source-of-truth hierarchy — present as the section immediately
  preceding this note.
- Document integrity note — this section.

**Document metrics:** 2246 lines, 135711 bytes (measured
2026-10-10, after final write of this note).

**Consistency binding.** If any count, status, or line reference in
this document is found to disagree with the repository at HEAD
`83a5e9e`, the repository evidence prevails and this document must be
regenerated, not patched piecemeal.
