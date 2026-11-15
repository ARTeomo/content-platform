# Content Platform — v1.4 Development Plan

**Status:** APPROVED 2026-11-15 (owner-approved together with the v1.4.0 contract amendment). The owner has authorized one commit, push, PR creation and merge for this finalization, conditional on all validation gates passing.
**Base:** branch `feat/v14-package1-contract-amendment` at `727e6e4` (= `origin/main`).
**Normative basis:** `DATABASE_SCHEMA_CONTRACT.md` v1.4.0 draft — §16.1–§16.5, §23.5 (INVARIANT-23..26), D-020 (DECIDED 2026-11-15). Where this plan and the contract disagree, the contract prevails.
**Scope decision (owner, 2026-11-15, binding):** discovery and SourceItem production are IN the v1.4 implementation scope. v1.4 must provide the upstream production flow (`Source → SourceEndpoint → DiscoveryObservation → DiscoveredResource → RawResource → SourceItem`); the normalization process must not depend on a SourceItem population mechanism that does not exist in the current codebase.

The `RawResource` step applies to the acquisition-backed path; on the inline path the `SourceItem` is extracted directly from the `DiscoveredResource` and no `RawResource` exists (§5.9, §5.10, §16.4, §16.5).
**Status discipline:** no package in this plan is implemented or closed, and no package becomes closed merely because this plan was updated. A package is CLOSED only when its closure evidence (§4 and §5) exists and the owner has reviewed it.

---

## 1. Evidence anchors (re-verified 2026-11-15)

- No discovery-side `source_items` writer exists: repo-wide search over `*.ts`/`*.mjs` finds only the Drizzle table definition (`packages/database/src/schema/ingestion/source-items.ts:23-53`); no repository, service, worker handler, API route, script, or test performs an insert/upsert. The same holds for `discovery_observations`, `discovered_resources`, and `raw_resources`.
- Both Neon databases hold zero rows across the entire upstream chain (`source_endpoints`, `discovered_resources`, `raw_resources`, `source_items`) and zero `content_versions` rows; `content_items` exists only via direct test-scaffolding inserts.
- The upstream pipeline is specified but unimplemented: contract §5.3–§5.10, §16; `LOGICAL_MODEL_SPECIFICATION.md` §10; `domain-model.md` (Ingestion domain); `TECHNICAL_SPECIFICATION.md` (DiscoveryHandler / AcquisitionHandler / ExtractionHandler; endpoint capabilities DISCOVERY / ACQUISITION / EXTRACTION).

## 2. Package sequence

| Package | Title                                                                                                                                                     | Status                                                                             |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| v1.4/1  | Contract v1.4.0 amendment, CP-F-20 clarification, this plan                                                                                               | CLOSED 2026-11-15 (owner-approved together with the v1.4.0 documentation baseline) |
| v1.4/2  | Repository implementations: upstream pipeline + canonical content/version chain                                                                           | OPEN — gated on package 1 approval                                                 |
| v1.4/3  | Discovery / acquisition / SourceItem production worker (NEW)                                                                                              | OPEN — gated on package 2                                                          |
| v1.4/4  | Normalization and canonical ContentItem/ContentVersion worker (renumbered from former v1.4/3)                                                             | OPEN — gated on package 3                                                          |
| v1.4/5  | Publication gate, concrete ContentVersion binding, migration `0021`, database constraints, fixtures, HANDOFF registration (renumbered from former v1.4/4) | OPEN — gated on package 4                                                          |

### 2.1 Plan-change rationale (smallest coherent change)

The prior slicing (contract → repositories → ingestion/normalization worker → publication gate) predates the owner scope decision and has no home for upstream production. Three options were weighed:

1. **Expand the former normalization package** to cover discovery through versioning in one worker package. Rejected: it mixes two capability families with different invariants (endpoint polling/state management/extraction vs canonical mapping/versioning under INVARIANT-23/24), producing an oversized, weakly reviewable package.
2. **Insert a dedicated discovery/SourceItem package** (chosen): new v1.4/3 owns the upstream flow; the former normalization package becomes v1.4/4; the former publication-gate package becomes v1.4/5; v1.4/2 expands naturally to upstream repositories.
3. **Re-sequence everything** (renumber all packages). Rejected as unnecessary: packages 1–2 keep their numbers and intent.

Option 2 is the smallest change that fully covers the approved scope: one insertion, two renumbers, one natural expansion, and it matches the required dependency order (§3) without preserving obsolete boundaries for numbering convenience.

## 3. Required dependency order (contract amendment §5.1 mapping)

1. Discovery/acquisition capability available → v1.4/3 (worker + handlers, on v1.4/2 repositories).
2. Discovery produces and persists `DiscoveryObservation` / `DiscoveredResource` records → v1.4/3 deliverable D3.1–D3.2.
3. `RawResource` acquisition/persistence where the endpoint requires fetching → v1.4/3 deliverable D3.3 (inline path requires no RawResource per §5.10).
4. SourceItem production implemented and traceable to its upstream origin → v1.4/3 deliverables D3.4–D3.5.
5. Normalization consumes eligible SourceItems → v1.4/4 (eligibility rules: contract §16.5).
6. Canonical ContentItems and immutable ContentVersions under INVARIANT-23/24 ownership and atomicity → v1.4/4 deliverables D4.1–D4.3.
7. Publication gating and concrete ContentVersion binding → v1.4/5 (migration `0021`, constraints, binding implementation).

## 4. Package definitions

Every package below defines: scope, explicit non-scope, prerequisites, deliverables, responsibilities (schema / repository / service / worker), data-flow hand-off, failure–retry–idempotency items, test and verification requirements, objectively demonstrable acceptance criteria, and the evidence required to close the package. Open design items are recorded, not silently decided.

### v1.4/1 — Contract amendment, CP-F-20 clarification, development plan

- **Scope:** contract v1.4.0 draft (§16.1–§16.5, §23.5 INVARIANT-23..26, D-020 DECIDED, header/§26 draft status); HANDOFF CP-F-20 clarification; this plan.
- **Non-scope:** any code, schema, migration, or database operation; commit/push (owner-withheld).
- **Prerequisites:** none (documentation only).
- **Deliverables:** the three documents listed under Scope, reviewed and approved by the owner.
- **Responsibilities:** schema — none; repository — none; service — none; worker — none.
- **Data-flow hand-off:** approved contract + plan unblocks v1.4/2.
- **Failure / retry / idempotency:** not applicable (documentation).
- **Tests / verification:** `pnpm format:check` passes; exactly the planned files changed; contract cross-reference scan (no stale OPEN/outside-scope text, no dangling § references).
- **Acceptance criteria (objective):** owner approves the complete diff of the three files.
- **Evidence to close the package:** the owner-approved diff record (and, once authorized, the single conventional commit on the feature branch). Package /1 closes as the owner-approved documentation baseline; Q11 and CP-F-20 remain OPEN and are not affected by this closure.
- **Open design items:** none at this layer; unresolved design questions are recorded in §6 below and in contract §16.5.

### v1.4/2 — Repositories: upstream pipeline + canonical content/version chain

- **Scope:** repository implementations for `sources`, `source_endpoints` (+ health reads as needed), `discovery_observations`, `discovered_resources`, `raw_resources`, `source_items`, `provenance_events`, and the canonical `content_items` / `content_versions` pair, following the existing repository conventions (`packages/database/src/repositories/`, `txManager.run` boundaries).
- **Non-scope:** worker services, scheduling, handlers, normalization logic, migrations, publication changes.
- **Prerequisites:** package 1 approval.
- **Deliverables:** D2.1 typed repository methods with transaction-scoped writes for all upstream tables; D2.2 due-endpoint selection query `(status, next_poll_at)` per §5.4; D2.3 DiscoveredResource resolve/insert-by-`canonical_url` and observation insert per §5.6–§5.7; D2.4 RawResource snapshot insert per §5.9; D2.5 SourceItem insert with `(source_id, source_item_id)` uniqueness handling per §5.10; D2.6 provenance insert per §5.8; D2.7 canonical-chain repositories needed by package 4 (ContentItem/ContentVersion atomic write primitive shaped for INVARIANT-24) and package 5.
- **Responsibilities:** schema — none (no schema change); repository — all of the above; service — none; worker — none.
- **Data-flow hand-off:** repositories consumed by v1.4/3 (upstream) and v1.4/4 (canonical).
- **Failure / retry / idempotency:** the repository layer is passive — no retry logic lives here; idempotency at this layer is constraint-based (`canonical_url` UNIQUE, `(source_id, source_item_id)` UNIQUE) and surfaces as conflict errors, not silent dedup; transaction boundaries of the repository write methods are settled here (Q5a) and documented per method.
- **Tests / verification:** package unit tests for query construction and mapping; DB-gated integration tests against `content-platform_test` only (journal 21 verified before run) covering every D2.x method: due-selection, insert, uniqueness-conflict behavior, provenance insert; no test writes to any other database.
- **Acceptance criteria (objective):** package builds (`pnpm --filter @content-platform/database build`); integration tests pass with exact totals reported; uniqueness conflicts demonstrably raised for duplicate `canonical_url` and duplicate `(source_id, source_item_id)`.
- **Evidence to close the package:** green test output with totals; `git show --stat` scope check (repository package + its tests only); CI run green on the (owner-authorized) commit.
- **Design decisions to be settled in this package:** Q5a — transaction boundaries of the repository write methods (D2.1–D2.7). (Repeated-discovery insert-vs-upsert semantics is Q2, owned by v1.4/3.)

### v1.4/3 — Discovery / acquisition / SourceItem production worker (NEW)

- **Scope:** the executable upstream production flow: endpoint polling scheduler, discovery handlers, acquisition, extraction, SourceItem persistence, and provenance writes, per contract §16.4 and the established handler model (`TECHNICAL_SPECIFICATION.md` §DiscoveryHandler/AcquisitionHandler/ExtractionHandler; endpoint capabilities DISCOVERY / ACQUISITION / EXTRACTION).
- **Non-scope:** normalization (no `content_items.content_item_id` writes), ContentVersion creation (INVARIANT-23 sole writer is package 4), publication changes, schema changes.
- **Prerequisites:** v1.4/2 repositories; worker config/dependency-injection conventions (`apps/worker/src/config.ts`, `index.ts` wiring).
- **Deliverables:** D3.1 due-active-endpoint scan and claim (optimistic `state_version` per §5.4); D3.2 discovery execution persisting `DiscoveryObservation` + `DiscoveredResource` with multi-path history; D3.3 acquisition persisting `RawResource` snapshots where required; D3.4 extraction persisting `SourceItem` on BOTH paths (raw-backed and inline, §5.10); D3.5 `provenance_events` writes with the corrected phase-to-target mapping (DISCOVERY → DISCOVERED_RESOURCE; ACQUISITION → RAW_RESOURCE, acquisition-backed path only; EXTRACTION → SOURCE_ITEM; contract §5.8, §16.4/§16.5); D3.6 config + worker wiring + scheduling integration following existing scheduler patterns.
- **Responsibilities:** schema — none; repository — consumes v1.4/2; service — discovery/acquisition/extraction services; worker — scheduler worker + handlers.
- **Data-flow hand-off:** persisted, provenance-complete, unmapped `SourceItem` rows (`content_item_id IS NULL`) become package 4's input.
- **Failure / retry / idempotency (settled in this package):** pipeline idempotency keys (Q1) — per-stage outbox/job anchors chosen and recorded; insert-vs-upsert and re-processing semantics on repeated discovery/extraction (Q2); retry policies per stage (Q4) — attempts, backoff, and terminal-failure shape; failure classification integrated with `source_endpoint_health` counters (§5.5; thresholds themselves are an open operational item); inline-path traceability sufficiency (Q6) — provenance-only vs direct link, with any schema consequence escalated to package 5, not taken silently.
- **Tests / verification:** handler unit tests with fixture feeds (RSS / Atom / HTML listing / API shapes — extraction formats Q3); scheduler tests (due selection, optimistic claim, no double-claim under concurrency); idempotency tests (repeated runs over one fixture endpoint do not duplicate `DiscoveredResource` and do not violate `(source_id, source_item_id)` uniqueness, per contract §16.5); traceability test (SourceItem → observation + RawResource when acquisition-backed → provenance rows); DB-gated integration tests against `content-platform_test`; explicit zero-write assertion on `content_items` / `content_versions`.
- **Acceptance criteria (objective):** the §5.3 end-to-end leg #1 (upstream input → persisted, traceable SourceItem) demonstrated in integration tests; repeated-run idempotency green; provenance rows present for every produced SourceItem; exact test totals reported, zero silently skipped.
- **Evidence to close the package:** green test output with totals; the leg-#1 demonstration evidence (fixture input + resulting rows + traceability query output); `git show --stat` scope check; CI run green.
- **Q6 closure coupling:** v1.4/3 may close only when the Q6 decision has been made, the selected approach has been implemented, and the leg-#1 traceability evidence demonstrates that the selected approach works. If the Q6 decision requires a schema change, the package sequence must be re-planned under owner review; v1.4/3 must NOT close on the basis of a traceability dependency deferred to v1.4/5.
- **Design decisions to be settled in this package:** Q1, Q2, Q3, Q4, Q5b (upstream stage orchestration boundaries), Q6.

### v1.4/4 — Normalization and canonical ContentItem/ContentVersion worker

- **Scope:** sole normalization actor: consumes eligible SourceItems (§16.5), owns the mapping bridge `source_items.content_item_id`, creates ContentItems and ContentVersions, and performs the atomic version-plus-pointer write (INVARIANT-23, INVARIANT-24). Renumbered from the former v1.4/3.
- **Non-scope:** upstream production (package 3), publication binding implementation (package 5), migration `0021`.
- **Prerequisites:** v1.4/3 output (eligible SourceItems); v1.4/2 canonical repositories.
- **Deliverables:** D4.1 eligibility selection per §16.5; D4.2 normalization mapping SourceItem → ContentItem (new or existing per the deduplication design item) with `content_item_id` set; D4.3 ContentVersion creation + `current_version_id` update in ONE transaction (INVARIANT-24) with provenance CONTENT_ITEM / CONTENT_VERSION targets (provenance phase per the Q11 owner decision — see the closure rule below); D4.4 sole-writer enforcement in code structure (single service owns version writes).
- **Responsibilities:** schema — none; repository — consumes v1.4/2 canonical primitives; service — normalization service (sole version writer); worker — normalization worker consuming a queue fed by package 3 completion (queue design is an open design item).
- **Data-flow hand-off:** canonical ContentItems with valid `current_version_id` and immutable ContentVersions become package 5's gate input.
- **Failure / retry / idempotency:** eligibility claim MUST be conditional (single-winner claim per existing scheduler precedent — no two normalizers map the same SourceItem); idempotency of the version write derives from the single-transaction boundary plus the mapping claim; failure mid-transaction rolls back both version and pointer (INVARIANT-24); re-processing after failure re-selects only still-eligible rows; re-normalization of already-mapped items remains open (Q8) — until decided, only unmapped items are eligible.
- **Tests / verification:** INVARIANT-24 atomicity tests with injected failure on each side (version-without-pointer and pointer-without-version both demonstrably impossible via rollback); concurrent-claim exactly-once test; eligibility tests (unmapped-only, required fields, traceability present); DB-gated integration tests against `content-platform_test`; provenance assertions.
- **Acceptance criteria (objective):** the §5.3 end-to-end leg #2 (eligible SourceItem → ContentItem + immutable ContentVersion + mapping set) demonstrated atomically; sole-writer structure reviewable from the code layout; exact test totals reported.
- **Evidence to close the package:** green test output with totals; atomicity test evidence; the leg-#2 demonstration evidence; `git show --stat` scope check; CI run green.
- **Design decisions to be settled in this package:** Q7 (deduplication algorithm), Q8 (re-normalization), Q9 (trigger/queue), Q11 (normalization provenance phase assignment — owner decision, per the Q-register).

**Closure coupling to the Q11 outcome.** v1.4/4 may close with D4.3's provenance-emission evidence only after the Q11 owner decision has been recorded and its implementation and schema consequences, if any, have been resolved or explicitly assigned to an owner-approved subsequent package. If the Q11 owner decision is to reuse an existing `provenance_events.phase` value, no schema consequence arises and the package sequence is unaffected. If the decision introduces a new provenance phase, the `provenance_events_phase_check` change is a schema change and cannot be assumed to wait silently for migration `0021`: the v1.4/4 ↔ v1.4/5 package boundary — pulling the phase-CHECK migration forward or deferring D4.3's provenance-emission evidence to v1.4/5 — must be re-planned under owner review before v1.4/4 closes. That re-planning explicitly re-scopes the v1.4/4 deliverables, test requirements, acceptance criteria, and closure evidence to exclude the deferred provenance work, and v1.4/4 closes only against the owner-approved re-scoped criteria. Under no outcome may that re-scoping defer or weaken the mandatory version-chain obligations — `ContentVersion` creation and the `current_version_id` update in ONE atomic transaction (INVARIANT-24), the INVARIANT-24 atomicity tests, the sole-writer code structure, and the leg-#2 end-to-end demonstration; only the Q11-dependent provenance-emission sub-deliverable, its assertions, and its evidence are deferrable, and only under owner-approved re-scoping. This records a dependency only; it does not decide Q11, introduces no new phase, and authorizes no schema change.

### v1.4/5 — Publication gate, version binding, migration `0021`, constraints, fixtures, HANDOFF registration

- **Scope:** enforce PUBLISHED-valid-current-version (INVARIANT-25) in the database, implement concrete publication binding to an immutable ContentVersion (§16.3), additive migration `0021`, integration fixtures, and HANDOFF registration of the v1.4 closure. Renumbered from the former v1.4/4.
- **Non-scope:** upstream production, normalization logic, any destructive or existing-data-modifying operation (the eight grandfathered ContentItems stay untouched, §16.2).
- **Prerequisites:** v1.4/4 output; contract I-3 enforcement design verified against the actual schema (CHECK for non-NULL; composite referential enforcement, possibly requiring a composite unique key on `content_versions(content_item_id, id)` — design verified here, per INVARIANT-25).
- **Deliverables:** D5.1 additive migration `0021` (journal 21 → 22) implementing the INVARIANT-25 constraints and the publication-version binding column(s)/FK per the verified design; D5.2 publication-gate application changes so a publication binds a concrete immutable ContentVersion; D5.3 fixtures + full-suite integration coverage; D5.4 HANDOFF registration (CP-F-20 resolution evidence, gate re-measurement, milestone section).
- **Responsibilities:** schema/migration — `0021` only, additive, SQL-reviewed; repository/service/worker — publication-path adjustments for version binding.
- **Data-flow hand-off:** v1.4 complete; CP-F-20 eligible for RESOLVED registration.
- **Failure / retry / idempotency:** migration failure handled per the established migration-validation workflow (re-run safe, no partial application left unverified); binding write idempotent under retry (re-binding the same concrete version is a no-op, not a duplicate); constraint violations fail closed at the gate.
- **Tests / verification:** migration applies cleanly on `content-platform_test` (journal 22 verified); constraint-rejection tests for every INVARIANT-25 violation shape (NULL pointer, dangling pointer, cross-item pointer — per the verified design); binding regression tests; grandfathered-rows verification (the eight rows remain NULL-pointer and byte-unchanged); full suite with both env vars (CI-gated) and the joined end-to-end chain (§5.3).
- **Acceptance criteria (objective):** all of the above green with exact totals; `git show --stat` scope check; HANDOFF registration diff complete.
- **Evidence to close the package:** green full-suite evidence (CI run ID); migration journal evidence; grandfathered-rows verification evidence; the §5.3 joined end-to-end run; HANDOFF registration committed with owner authorization.
- **Design decisions to be settled in this package:** Q10 (INVARIANT-25 composite referential design and publication-binding column shape).

## 5. End-to-end flow acceptance (acceptance must prove a real flow)

Package acceptance must prove a real, testable flow, not plan text. The v1.4 chain is accepted only when a demonstrable end-to-end path exists:

```text
upstream source/discovery input (fixture feed/HTML, or owner-authorized live source)
→ persisted DiscoveryObservation + DiscoveredResource
→ (RawResource where acquisition-backed)
→ persisted SourceItem (traceable, unmapped, provenance-complete)
→ normalization
→ ContentItem with valid current_version_id + immutable ContentVersion
```

- **Leg #1** (input → persisted SourceItem) is v1.4/3 closure evidence.
- **Leg #2** (eligible SourceItem → canonical ContentItem + ContentVersion) is v1.4/4 closure evidence.
- **The joined end-to-end run** is repeated at v1.4/5 full-suite scope before CP-F-20 may be registered RESOLVED.

The acceptance criteria distinguish (all four tiers are required; none substitutes for another):

1. **Unit tests** — handler, mapping, and query-construction logic in isolation.
2. **Repository/integration tests** — DB-gated tests against `content-platform_test` (journal verified) exercising the persisted path.
3. **Worker / orchestration tests** — scheduler scans, claims, concurrency, and stage orchestration, including repeated-run idempotency.
4. **End-to-end lifecycle evidence** — the joined flow from upstream input through persisted SourceItem creation to normalization output (leg #1 / leg #2 above, plus the joined run).

A fixture that inserts SourceItems directly does NOT count as proof that discovery produces SourceItems: SourceItem rows created by test setup bypass the upstream-evidence rules (contract §16.5) and cannot demonstrate leg #1; end-to-end evidence must show SourceItems arising from the discovery/acquisition/extraction path itself.

Default upstream input is fixture-driven (static feeds / HTML / API payloads), CI-gated against `content-platform_test` only; a run against a real external source is owner-authorized evidence (WP-11 live-validation pattern) and is never required for package closure. Each package closes on its own leg, and the joined chain must additionally be demonstrated before v1.4/5 closes. A package is CLOSED only by produced closure evidence plus owner review; statuses in this plan (OPEN / GATED / DRAFT) are planning states, never implementation claims, and updating this plan changes no package status.

## 6. Unresolved design questions (recorded, not decided)

Neither the contract nor this plan decides the following; each is assigned to the package that must settle it:

| #   | Question                                                                                                                                                                                                                                            | Owning package                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Q1  | Pipeline idempotency keys (outbox/job anchors per stage)                                                                                                                                                                                            | v1.4/3                                                 |
| Q2  | Insert-vs-upsert and re-processing semantics on repeated discovery/extraction                                                                                                                                                                       | v1.4/3                                                 |
| Q3  | Extraction formats per representation (feed, HTML, API)                                                                                                                                                                                             | v1.4/3                                                 |
| Q4  | Retry policies for discovery / acquisition / extraction                                                                                                                                                                                             | v1.4/3                                                 |
| Q5a | Transaction boundaries of repository write methods                                                                                                                                                                                                  | v1.4/2                                                 |
| Q5b | Transaction/orchestration boundaries between the discovery, acquisition, and extraction stages                                                                                                                                                      | v1.4/3                                                 |
| Q6  | Inline-path traceability sufficiency (provenance-only vs direct link)                                                                                                                                                                               | v1.4/3 (schema consequence, if any → v1.4/5)           |
| Q7  | ContentItem deduplication algorithm                                                                                                                                                                                                                 | v1.4/4                                                 |
| Q8  | Re-normalization of already-mapped SourceItems (new ContentVersion on change)                                                                                                                                                                       | v1.4/4                                                 |
| Q9  | Normalization trigger/queue mechanism                                                                                                                                                                                                               | v1.4/4                                                 |
| Q10 | INVARIANT-25 composite referential design and publication-binding column shape (see the CHECK note below)                                                                                                                                           | v1.4/5                                                 |
| Q11 | Normalization provenance phase assignment: which phase applies to normalization outcomes targeting CONTENT_ITEM / CONTENT_VERSION, given that §5.8 defines exactly DISCOVERY / ACQUISITION / EXTRACTION (DB-level CHECK) and no NORMALIZATION phase | v1.4/4 (decision; schema consequence, if any → v1.4/5) |

**Q10 design-constraint note (recording, not a solution):** a PostgreSQL CHECK constraint — including one added with `NOT VALID` — is evaluated on every subsequent INSERT or UPDATE of a row. This applies to the eight grandfathered rows as well; enforcement is not limited to status transitions. The migration `0021` design must account for this behavior. This note records a design constraint only: it does not alter contract §16.2 or INVARIANT-25, does not choose a technical workaround, does not imply that the grandfathered rows may be modified, and does not decide the final migration design.

**Q11 note — normalization provenance phase (recording, not a decision):** recorded in contract §16.5 ("Provenance and traceability"). Required resolution: an explicit owner decision — reuse of an existing phase vs introducing a `NORMALIZATION` phase — with consequences for contract, implementation, and evidence. Implementation consequence: a new phase requires changing the DB-level `provenance_events_phase_check` constraint — a schema change, plannable only in v1.4/5, coordinated with migration `0021`; neither the migration nor its content is pre-authorized; if the v1.4/4 decision requires the phase change earlier, the v1.4/4 closure rule (above) governs the re-planning of the package boundary. Status: OPEN — no phase assignment or schema change is assumed. Adding Q11 does NOT approve a `NORMALIZATION` phase.

## 7. Preserved requirements (unchanged by this plan)

- INVARIANT-23 sole ContentVersion writer; INVARIANT-24 atomic version+pointer; INVARIANT-25 PUBLISHED-valid-current-version; INVARIANT-26 independent editorial counter (contract §23.5).
- Publication binding to a concrete immutable ContentVersion (contract §16.3).
- Grandfathering of the eight existing NULL-`current_version_id` ContentItems for their current state only; no fabricated historical versions; no general exemption (contract §16.2).

## 8. Operational constraints (binding for all packages)

- Online-first / append-only policy: registered Neon + Upstash only; no local substitutes; the evidence DB `content-platform` is never written; integration tests use `content-platform_test` only, after verifying the target; every database command inspected and classified before execution.
- No commit, push, PR, merge, or history rewrite without explicit owner authorization; conventional single-line commit subjects only.
- Migration journal stays at 21 until package 5's additive `0021`.
