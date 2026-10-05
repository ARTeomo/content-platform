# Content Platform — Database Schema Contract

**Version:** 1.3.1
**Status:** Production-Ready DB v1.3.1 Persistence Contract — Zero-Downtime Schema Migration with Bounded Write Fence
**Normative:** Yes — implementation baseline
**Generated:** 2026-10-05
**Scope:** PostgreSQL persistence model for the Content Platform. DB v1 distinguishes the 15-table core logical model from supporting platform persistence tables required by the established technical design.
**Migration set:** starts at `0015` (Path A). Path B is a consolidated greenfield baseline. See §20.
**Consolidated baseline:** This document is a self-contained, standalone persistence contract. It supersedes all prior versions of `DATABASE_SCHEMA_CONTRACT.md` (v1.0 through v1.3) and does not require the reader to consult any earlier revision for table definitions, invariants, or deferred decisions.

---

## Revision History

**Revision 1.0** — Initial DB v1 persistence contract. Defined the 15-table core logical model and 18 supporting platform persistence tables.

**Revision 1.1** — Extended the contract with the inbound Meta webhook slice: webhook subscriptions, webhook event receipts, delivery attempts, external interactions, provider credentials, interaction response lifecycle, and the unified transactional outbox.

**Revision 1.2** — Added `webhook_subscription_health`, the hot-path `publications.external_post_id` partial index, and refinements to three deferred decisions.

**Revision 1.3** — Introduced two aggregate-boundary changes: `webhook_endpoints` (D-013) and the provider-aware `external_interactions` natural key (D-016). Required the EXPAND / MIGRATE / SWITCH / CONTRACT migration protocol for these changes.

**Revision 1.3.1** — The production-ready consolidated baseline. Establishes:

- `webhook_endpoints` as the App-level verify token owner;
- the provider-aware natural key `(provider, external_interaction_id)`, enforced by `external_interactions_provider_external_id_uq`;
- the target-state authoritative verify-token AAD `META:WEBHOOK_VERIFY_TOKEN:<endpoint_id>`;
- single-Meta-App-per-deployment scope;
- the versioned webhook token encryption key model (`WEBHOOK_TOKEN_ENCRYPTION_KEYS` + `WEBHOOK_TOKEN_ENCRYPTION_ACTIVE_VERSION`);
- the Compatibility Bridge deployment state and Hard Gate #1 / #2 sequencing;
- Path A (upgrade) and Path B (greenfield) migration separation;
- preservation of existing durable business data across migration (INVARIANT-14);
- the outbox idempotency anchor (`outbox_jobs.job_id UNIQUE`) as the authoritative mechanism (INVARIANT-16);
- the migration fence applied to all writers of `external_interactions`, `webhook_subscriptions`, and `webhook_endpoints` (INVARIANT-08);
- a complete token rotation dual-write rule across endpoint and subscription representations (INVARIANT-17);
- a Bridge endpoint upsert compare-and-abort rule (INVARIANT-18);
- content-level preservation evidence via SHA-256 digests (INVARIANT-19);
- a single-session requirement for the `0016` advisory lock (INVARIANT-20);
- a recoverable transitional state model for `0016` failure recovery (§20.2.8);
- an **immutable pre-migration preservation baseline** captured before any `0016` data modification, used by every recovery attempt without recomputation (INVARIANT-22, §20.2.3 step 1a, §2.8.9);
- a **canonical-JSON preservation digest implementation specification** (§2.8);
- a **formal `0016` transaction/session state machine** (§20.2.9);
- unified terminology: **"zero-downtime schema migration + bounded write fence"** throughout (§20.0, §26);
- a precise `occurred_at` monotonicity definition (D-018, §5.39).

The v1.3.1 baseline is self-contained and does not require reference to any prior version.

### Supersession of higher-level documents

This contract is authoritative for the physical persistence model. The following statements in higher-level documents are superseded by this revision:

- `TECHNICAL_SPECIFICATION.md v0.9.0 §136` — `webhook_endpoints` and the provider-aware natural key are **in scope** for v1.3, not Post-MVP.
- `META_INTEGRATION_SPECIFICATION.md v1.4 §5` — `webhook_endpoints` is **not** an explicit non-goal.
- `META_INTEGRATION_SPECIFICATION.md v1.4 §48` — the provider-aware natural key is **in scope**, not future.

The referenced higher-level documents must be revised to §5.34, §5.39, §5.35, and §23.4 of this document.

---

## Contract Scope and Interpretation

This document is a **normative contract**, not a work-in-progress specification. It defines the required target state of the Content Platform persistence model at DB v1.3.1. Every normative statement in this document is binding.

### Contract status versus implementation status

The `Status` field above describes **this document** as a specification. It does NOT assert that any particular codebase, repository, or deployment currently conforms to it.

The relationship is strictly:

```text
DATABASE_SCHEMA_CONTRACT v1.3.1
        = production-ready TARGET CONTRACT

Current repository
        = a state that MAY or MAY NOT conform

Refactoring
        = the process of bringing the current repository
          into conformance with this contract
```

No aspect of the current repository state — including existing migration files, existing repositories, existing encryption providers, or existing index definitions — is to be interpreted as evidence of conformance. Conformance is established only by explicit verification against this document, per §22 (Validation Requirements).

### Interpretation rules

The following interpretation rules are normative:

1. `MUST`, `MUST NOT`, `REQUIRED`, `SHALL`, `SHALL NOT` indicate mandatory requirements.
2. `SHOULD`, `SHOULD NOT`, `RECOMMENDED` indicate strong recommendations but not mandatory requirements.
3. `MAY`, `OPTIONAL` indicate genuinely optional behavior.
4. `Allowed`, `Forbidden`, `Permitted` in this document refer to the transformation and change matrix in §2.6.
5. A statement marked with an `[INVARIANT-xx]` identifier is a strictly normative invariant. Its interpretation MUST NOT be relaxed by any other statement in this document.
6. Where two statements in this document could be read as conflicting, the invariant-bearing statement prevails.
7. Where this document conflicts with any earlier version of `DATABASE_SCHEMA_CONTRACT.md`, this document prevails.
8. Where this document conflicts with a higher-level domain or architecture contract, this document is authoritative for the physical persistence layer; the higher-level document MUST be revised in the same release cycle (see §1 Source-of-truth hierarchy).
9. Every SQL statement in this document is illustrative of the required semantics. Physical migration files MUST produce the same semantics but MAY differ in formatting, transaction structure, or statement ordering, subject to the sequencing rules in §20 and the state machine defined in §20.2.9.
10. Every reference to a column, table, index, or constraint name refers to the exact identifier stated. Renames are contract violations.
11. A "target state" refers to the schema state after `0018 CONTRACT` (Path A) or after the consolidated baseline (Path B). A "transitional state" refers to an intermediate schema state during Path A.
12. The phrase "byte-for-byte" (as used in INVARIANT-14 and §2.6) refers to the value of the durable business columns, not to physical storage representation (MVCC metadata, TOAST layout, or page-level byte layout are not part of this guarantee). The precise interpretation is given in §2.7.
13. The index object `external_interactions_provider_external_id_uq` is the **authoritative name** for the provider-aware natural key enforcement object. Any earlier name (including `external_interactions_provider_ext_id_idx` and `external_interactions_provider_external_id_idx`) is superseded. Refactoring implementations MUST use the authoritative name.
14. **"Zero-downtime" in this document always means "zero-downtime schema migration with bounded write fence"** as defined in §20.0. It never means unrestricted runtime zero-downtime. Any occurrence of "zero-downtime" without the qualifier MUST be read with this qualification.

### Contract self-consistency audit

Because this document is normative and will be the basis of downstream refactoring, the following self-consistency audit checklist is part of the contract. Every checklist item MUST hold true in this document's text.

| #   | Consistency check                                                                                                                         | Where satisfied                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1   | Every `[INVARIANT-xx]` references at least one concrete § or table definition                                                             | §2.2, §5, §20                         |
| 2   | Every table in §3.2 has a §5.x subsection                                                                                                 | §5.1–§5.45                            |
| 3   | Every §5.x table matches the corresponding schema description in §3 and §19                                                               | §3.2, §5, §19                         |
| 4   | Every index in §8 has a corresponding reference in §5.x                                                                                   | §5, §8                                |
| 5   | Every foreign key in §7 is declared with the same nullability as in §5.x                                                                  | §5, §7                                |
| 6   | Every referential action in §7 is consistent with §4.5                                                                                    | §4.5, §7                              |
| 7   | Every `ON DELETE SET NULL` in §7 is paired with a nullable column                                                                         | §4.5, §7.2                            |
| 8   | Every `NOT NULL` FK uses `RESTRICT` or `CASCADE`                                                                                          | §4.5, §7.1, §7.3                      |
| 9   | Every migration step in §20 is compatible with INVARIANT-14 and §2.6                                                                      | §2.6, §20                             |
| 10  | Every Path A transformation in §20.2 maps to an Allowed row in §2.6                                                                       | §2.6, §20.2                           |
| 11  | Every Path A rollback claim is supported by a state that exists in some earlier phase or by §20.2.8                                       | §20.2.2, §20.2.5, §20.2.8             |
| 12  | No sentence in this document contradicts an `[INVARIANT-xx]`                                                                              | whole document                        |
| 13  | No sentence in this document admits two incompatible readings                                                                             | whole document                        |
| 14  | No sentence in this document refers to "current implementation" as evidence of conformance                                                | whole document                        |
| 15  | v1.2 / Phase 19 business data has no implicit overwrite path                                                                              | §2.2 INVARIANT-14, §2.6, §20.2.3      |
| 16  | Every `0016` failure mode has an explicitly named resulting state                                                                         | §20.2.8                               |
| 17  | The single-session advisory-lock requirement is explicit                                                                                  | INVARIANT-20, §20.2.3                 |
| 18  | The immutable pre-migration preservation baseline is captured before any `0016` data modification and is never recomputed during recovery | INVARIANT-22, §20.2.3 step 1a, §2.8.9 |
| 19  | The `0016` transaction/session state machine is explicitly defined                                                                        | §20.2.9                               |
| 20  | The "zero-downtime" terminology is consistently qualified throughout the document                                                         | §20.0, §26, Interpretation rule 14    |
| 21  | The `occurred_at` monotonicity wording is precise and unambiguous                                                                         | §5.39, D-018                          |

---

## 1. Purpose

This document defines the physical PostgreSQL persistence contract for DB v1.3.1 of the Content Platform.

It translates the finalized DB v1 Logical Model Specification into explicit relational tables, columns, foreign keys, uniqueness rules, indexes, lifecycle constraints, deletion behavior, and migration requirements.

The logical model remains the architectural source of truth for entity meaning and relationships. This document is the authoritative source for PostgreSQL-specific persistence decisions that implement that logical model.

The database contract must not redefine the logical domain model. Supporting platform tables may be included where required by the established technical design, but they are explicitly identified as outside the core logical model.

### Source-of-truth hierarchy

1. Domain and architecture contracts
2. `DB v1 Logical Model Specification v1.0`
3. This `DATABASE_SCHEMA_CONTRACT.md` (v1.3.1)
4. Drizzle schema implementation
5. Generated PostgreSQL migrations

If a higher-level architectural contract changes, this document must be revised before the dependent Drizzle schema or migrations are changed. Conversely, if this document introduces a change that the higher-level documents do not yet reflect, the higher-level documents must be revised in the same release cycle.

---

## 2. Database Principles & Strict Migration Invariants

### 2.1 Database principles

- PostgreSQL is the authoritative durable system of record.
- Redis/BullMQ is the asynchronous execution layer and is not authoritative business state.
- Worker execution attempts, retry metadata, transient execution timing, and worker-level diagnostics are not canonical PostgreSQL entities in DB v1.
- All timestamps use `timestamptz` and represent UTC instants.
- Database-generated entity identifiers use UUIDs unless an external identifier is explicitly represented as text.
- Lifecycle states are persisted as text values and validated by database constraints where the vocabulary is finalized.
- Structurally variable configuration and metadata use `jsonb`.
- Endpoint state is persisted as `jsonb` because it is polymorphic and endpoint-specific.
- Foreign keys enforce relational integrity.
- Unique constraints and unique indexes enforce deterministic business identities.
- Immutable history and provenance records are append-oriented.
- Secrets are not stored as plaintext in ordinary application tables.
- Operational health is separated from endpoint and subscription configuration.
- Canonical content identity is separated from source and discovery identity.
- Discovery observations are preserved separately from canonical discovered-resource identity.
- Raw acquisition artifacts may have multiple snapshots for the same discovered resource.
- PostgreSQL-specific implementation details must not change the logical meaning of the model.
- Production schema changes follow `EXPAND → MIGRATE → SWITCH → CONTRACT`.

### 2.2 Strict migration invariants

These invariants are normative for the v1.3.1 migration protocol (§20). They MUST NOT be weakened.

- **[INVARIANT-01] Non-Ciphertext Domain Mapping.** The `webhook_subscriptions.verify_token_encrypted` column MUST NOT be used as a natural key or grouping attribute to derive `webhook_endpoints`, because the AAD varies per destination. Endpoint mapping MUST be derived deterministically from domain-level entity relationships. In v1.3.1, the domain-level identity of an endpoint is `(provider, name)`, where `name` is derived from the deployment-level configuration — not from any row in the subscription or destination tables (see §20.2.3). If no deterministic mapping can be derived, the migration MUST fail immediately with an unrecoverable exception.

- **[INVARIANT-02] Dual Representation & Non-Destructive Migration.** The `0016 MIGRATE` phase MUST NOT overwrite or destroy legacy `webhook_subscriptions.verify_token_*` columns. The legacy token data MUST remain intact until `0018 CONTRACT` succeeds.

- **[INVARIANT-03] Migration Idempotency.** The `0016 MIGRATE` phase MUST be strictly idempotent. Interruption or re-execution MUST NOT result in double-encryption, duplicate `webhook_endpoints` creation, or data loss. When re-executing on an already-migrated row, the runner MUST verify byte-equality of the re-derived endpoint ciphertext with the existing ciphertext; on mismatch, it MUST fail (see §20.2.3). Idempotency MUST hold in every failure mode described in §20.2.8, including the partial-0016 data state.

- **[INVARIANT-04] Deployment Compatibility & Contract Gate.** The `0018 CONTRACT` phase MUST only execute when it is verified that zero active application instances depend on the legacy schema.

- **[INVARIANT-05] Compatibility Bridge & Live-Write Stabilization.** Before running `0016 MIGRATE`, application instances MUST run in Compatibility Bridge mode. The Bridge populates both legacy fields and expanded v1.3 fields on every affected write. This eliminates TOCTOU races during backfill.

- **[INVARIANT-06] Bridge Token Encryption Write-Path.** Any new or rotated verify token written by Bridge code MUST be encrypted and written under BOTH representations: legacy ciphertext using `META:WEBHOOK_VERIFY_TOKEN:<destination_id>` AAD in `webhook_subscriptions`, AND endpoint ciphertext using `META:WEBHOOK_VERIFY_TOKEN:<endpoint_id>` AAD in `webhook_endpoints`.

- **[INVARIANT-07] Dual-Write Maintenance During SWITCH.** During `0017 SWITCH`, v1.3 application code MUST remain backward-write-compatible until Hard Gate #2 is satisfied. All mutations affecting migrated entities MUST preserve both the v1.3 representation and the legacy representation until the rollback window is formally closed.

- **[INVARIANT-08] Migration Fence & Mutual Exclusion.** The `0016 MIGRATE` phase MUST acquire a PostgreSQL advisory lock on a fixed key for its entire duration. While the lock is held:
  - Bridge code MUST NOT perform token writes.
  - **All application write paths** capable of inserting, updating, or deleting rows in `external_interactions`, `webhook_subscriptions`, or `webhook_endpoints` MUST either:
    1. fail closed, or
    2. participate in the migration lock protocol.
  - No writer may bypass the migration fence.

  PostgreSQL advisory locks are cooperative; the database engine does not enforce participation. Application-level compliance with this fence is a **normative requirement of this contract**. Any application path that writes to the three tables above without observing the advisory lock is in violation of this contract and MUST be rejected at code review and by CI checks that enforce the presence of the lock-aware wrapper.

- **[INVARIANT-09] Endpoint Token Integrity.** If the Bridge created an endpoint token before `0016 MIGRATE` runs, the migration MUST NOT overwrite it. The migration MUST decrypt the endpoint ciphertext and the legacy ciphertext, and fail if the two plaintexts differ (see §20.2.3).

- **[INVARIANT-10] Hard Gate Atomicity.** All Hard Gate #1 checks that depend on data consistency (collision scans, plaintext equality) MUST execute inside a single `SERIALIZABLE` transaction, and MUST complete before `0017 SWITCH` begins. The `CREATE UNIQUE INDEX CONCURRENTLY` step is necessarily outside that transaction (see §20.2.3 step 5b) and is followed by an explicit catalog-validation step before the final Gate #1 assertion (§20.2.4). The full transaction/session sequencing is defined normatively in §20.2.9.

- **[INVARIANT-11] D-016 Constraint Form.** The provider-aware natural key is enforced by a **unique index** named `external_interactions_provider_external_id_uq`. PostgreSQL does not support converting an index built with `CREATE INDEX CONCURRENTLY` into a UNIQUE constraint via `ALTER TABLE ... ADD CONSTRAINT ... USING INDEX`. The unique index is the authoritative enforcement mechanism. All references in this document use the term **UNIQUE INDEX**, never `UNIQUE CONSTRAINT`, for this object. The name `external_interactions_provider_external_id_uq` is authoritative; earlier names (`external_interactions_provider_ext_id_idx`, `external_interactions_provider_external_id_idx`) are superseded and MUST NOT be used by any conformance implementation.

- **[INVARIANT-12] Single-App Scope.** DB v1.3.1 supports exactly one Meta App per deployment. The `webhook_endpoints` aggregate models N Pages under one App. Multi-App support is deferred to a future revision (see §24, D-013).

- **[INVARIANT-13] Deployment-Level Endpoint Identity.** The `name` column of `webhook_endpoints` is deployment-level App identity sourced from deployment configuration. It MUST NOT be derived from any `webhook_subscriptions` row, destination row, or Page-specific data. Under INVARIANT-12, the deployment MUST contain exactly one `webhook_endpoints` row for the active Meta App after `0016 MIGRATE` completes. If zero or more than one row matches the configured App identity, the migration MUST abort.

- **[INVARIANT-14] Historical Business Data Preservation.** The `0015`–`0018` migration MUST preserve all existing durable business data in the deployment. No existing publication, publication attempt, publication reconciliation, external interaction, webhook event, webhook delivery, provider credential, interaction response, interaction response attempt, interaction moderation action, interaction response reconciliation, or outbox history row may be deleted, rewritten, or semantically reinterpreted, except for the explicitly defined additive/backfill transformations listed in §2.6. The migration MUST NOT replace the existing database with a greenfield schema. Applying Path B (greenfield baseline, §20.3) to a database containing production business data is a contract violation. Preservation is verified per §2.7, INVARIANT-19, and INVARIANT-22.

- **[INVARIANT-15] No Redundant Transitional Index.** The `0015 EXPAND` phase MUST NOT create an index that duplicates the column set of the authoritative D-016 unique index built in `0016`. Creating a non-unique transitional index such as `external_interactions_provider_external_id_idx` is prohibited because it would (a) coexist with the unique index and (b) not be removed by `0018 CONTRACT`, violating §8 index discipline.

- **[INVARIANT-16] Outbox Idempotency Anchor.** The authoritative idempotency anchor for outbox-managed side effects is the PostgreSQL `outbox_jobs.job_id UNIQUE` constraint. BullMQ `jobId` deduplication reduces duplicate queue insertion during recovery but MUST NOT be treated as a sufficient guarantee of exactly-once side-effect execution. Every downstream worker and external side effect MUST be independently idempotent with respect to `job_id`.

- **[INVARIANT-17] Token Rotation Dual-Write Rule.** When a verify token is rotated — during the Compatibility Bridge deployment, during `0017 SWITCH`, or during the normal post-`0018 CONTRACT` operation while any legacy representation still exists — the rotation transaction MUST update every representation that remains authoritative for any reader:
  - **Endpoint representation:** `webhook_endpoints.verify_token_encrypted` and `verify_token_key_version` MUST be updated using AAD `META:WEBHOOK_VERIFY_TOKEN:<endpoint_id>`.
  - **Legacy subscription representation (during the migration window):** for EVERY `webhook_subscriptions` row that references the rotated endpoint, `verify_token_encrypted` and `verify_token_key_version` MUST be updated using that subscription's own AAD `META:WEBHOOK_VERIFY_TOKEN:<destination_id>`. All affected rows MUST be updated in the SAME transaction as the endpoint write. Partial rotation is a contract violation.
  - **`webhook_endpoints.last_rotated_at`** MUST be updated in the same transaction.
  - An `audit_logs` entry MUST be written recording the rotation event.
  - After `0018 CONTRACT`, the legacy subscription columns no longer exist; the rule then reduces to the endpoint representation only.

  Failure to update every legacy subscription ciphertext during the migration window creates a split-brain token state: a v1.2 rollback would read stale tokens from some subscriptions. This is a contract violation and MUST be prevented by the Bridge and v1.3 write paths alike.

- **[INVARIANT-18] Bridge Endpoint Upsert Conflict Rule.** When the Compatibility Bridge (or any v1.3 write path during the migration window) resolves the deployment's single `webhook_endpoints` row for the active Meta App and discovers that the row already exists, the write path MUST decrypt the existing endpoint ciphertext using AAD `META:WEBHOOK_VERIFY_TOKEN:<endpoint_id>`. If the resulting plaintext differs from the plaintext associated with the incoming write (for example, a new Page subscription whose onboarding flow yields a different plaintext verify token), the write path MUST:
  - abort the transaction,
  - leave `webhook_endpoints.verify_token_encrypted`, `verify_token_key_version`, `last_rotated_at`, and `updated_at` unchanged,
  - leave all existing `webhook_subscriptions` rows unchanged,
  - surface a structured error that distinguishes "token mismatch" from any other failure mode,
  - MUST NOT silently overwrite the App-level endpoint token.

  Under INVARIANT-12, at most one Meta App is active per deployment. Under INVARIANT-13, that App is identified by deployment-level configuration. Therefore, a second distinct plaintext reaching the same App-level endpoint is not a legitimate concurrent write — it is a configuration error, a mis-routed subscription, or a Bridge bug, and the contract requires it to fail closed. Silent overwrite is a contract violation and MUST be prevented at the repository layer, the service layer, and by CI checks that assert the endpoint upsert path is a strict compare-and-abort-or-noop operation.

- **[INVARIANT-19] Preservation Evidence.** INVARIANT-14 MUST be verified, not merely asserted. For every durable business table listed in §2.6 as **protected** (i.e. no row may be modified by the migration), the migration runner MUST compute and record a content-level preservation evidence digest for the pre-migration snapshot and the post-migration snapshot, excluding only the columns explicitly listed in the Allowed column of §2.6. The canonical digest algorithm is specified in §2.8. The digest MUST be computed as:

  ```text
  SHA-256(
    canonical_json(
      SELECT <all protected columns>
      FROM <table>
      ORDER BY <stable_sort_key>
    )
  )
  ```

  where `<stable_sort_key>` is the primary key of the table (or a documented stable total order when the primary key is not suitable), and `canonical_json` is the serialization defined in §2.8. The digest MUST be written to `audit_logs` at the end of `0016 MIGRATE`, before Hard Gate #1 is declared satisfied.

  **The pre-migration digest MUST be computed by the migration runner itself and MUST be persisted immutably per INVARIANT-22 and §2.8.9, before the first `0016` data modification is executed.** The post-migration digest MUST be computed by the migration runner itself. The migration runner MUST compare the post-migration digest against the **immutably persisted pre-migration digest** — never against a recomputed baseline — and MUST fail if they differ for any protected table. If the immutably persisted pre-migration digest is missing at the moment of comparison, the migration MUST abort; recomputing a pre-migration baseline from the current state is a contract violation (INVARIANT-22).

  The set of protected tables is:

  ```text
  publications
  publication_attempts
  publication_reconciliations
  webhook_events
  webhook_deliveries
  provider_credentials
  interaction_responses
  interaction_response_attempts
  interaction_moderation_actions
  interaction_response_reconciliations
  outbox_jobs
  ```

  Tables not listed here either have no durable business rows at migration time or are explicitly allowed to be modified by the transformations in §2.6. The set of protected tables MUST NOT be silently reduced; any reduction requires a formal contract revision.

- **[INVARIANT-20] Single-Session Advisory-Lock Requirement.** The `0016 MIGRATE` phase MUST execute on a **single dedicated PostgreSQL session** for the complete duration of the migration, including:
  - the transactional phases (data validation, collision scan, backfill),
  - the non-transactional `CREATE UNIQUE INDEX CONCURRENTLY` phase (§20.2.3 step 5b),
  - the catalog-validation phase (§20.2.3 step 5c),
  - the preservation-evidence snapshot and comparison phase (§20.2.3 step 6),
  - the Hard Gate #1 sequence (§20.2.4) up to and including the final Gate #1 assertion.

  The advisory lock acquired at the start of `0016 MIGRATE` is a **session-level** PostgreSQL advisory lock (`pg_advisory_lock(<fixed_key>)`). It remains held for the life of the session and is released only on explicit `pg_advisory_unlock`, session termination, or connection loss. Transaction boundaries — including `COMMIT` and `ROLLBACK` — do NOT release a session-level advisory lock.

  A connection-pooled implementation that releases the underlying connection between phases of `0016` violates this invariant: another session may acquire the same advisory lock while the first session's work is incomplete. Any migration runner that uses a connection pool MUST pin a single physical connection to the entire `0016` phase and MUST NOT return that connection to the pool until `0016` — including the post-`CREATE INDEX CONCURRENTLY` catalog validation — has completed.

  If the dedicated session is terminated unexpectedly (connection loss, process kill, failover), the advisory lock is released by PostgreSQL, and the migration enters the partial-0016 state described in §20.2.8. Recovery proceeds by re-running the migration runner; the runner MUST detect the partial-0016 state, re-acquire the advisory lock on a fresh dedicated session, and continue from the appropriate step, always using the immutably persisted pre-migration baseline (INVARIANT-22).

  The full transaction/session state machine is defined normatively in §20.2.9.

- **[INVARIANT-21] Post-Failure Recovery Contract.** When any step of `0016 MIGRATE` fails — including the `CREATE UNIQUE INDEX CONCURRENTLY` step, the post-build catalog validation, or the preservation-evidence comparison — the deployment MUST NOT be described as returning to the "`0015` + Bridge state." Such a return is not achievable in general, because earlier steps of `0016` may have already committed data changes (`webhook_subscriptions.endpoint_id` backfill, `external_interactions.provider` backfill, and any Bridge-created `webhook_endpoints` row that predated `0016`). The deployment instead enters the **partial-0016 state** defined in §20.2.8.

  The partial-0016 state is a legitimate, bounded, recoverable transitional state, not a rollback state. The migration runner MUST be idempotent (INVARIANT-03) and MUST resume from the earliest step whose completion cannot be proven. No manual `UPDATE` or `DELETE` against `webhook_subscriptions`, `external_interactions`, `webhook_endpoints`, or any protected table is permitted as part of failure handling; all recovery MUST be performed by re-running the migration runner.

- **[INVARIANT-22] Immutable Pre-Migration Preservation Baseline.** The pre-migration preservation digest set defined by INVARIANT-19 MUST be computed by the migration runner and MUST be persisted immutably **before the first `0016` data modification is executed**, in the same `0016` phase, using a dedicated reserved `audit_logs` action (`PRESERVATION_BASELINE_CAPTURED`, see §5.33 and §18.14). The immutable baseline record is:

  - written exactly once per protected table per `0016` phase;
  - written inside a transaction that commits before Step 2 (the `endpoint_id` backfill) executes;
  - once written, `MUST NOT` be modified, deleted, or superseded by any subsequent recovery attempt;
  - the sole authoritative comparison target for the post-migration digest computed in Step 6.

  During recovery, the migration runner MUST NOT recompute a new pre-migration baseline from the current (possibly partial) state. If the immutable baseline records exist, they MUST be used as-is. If the immutable baseline records do NOT exist — for example, because the process crashed before Step 1a committed — the recovery attempt MUST treat this as a hard failure and abort, unless the deployment is verifiably still in the pre-`0016` schema state (i.e. no `0016` data modification has been committed). The precise recovery decision procedure is defined in §20.2.8.

  The rationale is that the preservation guarantee is only as strong as the integrity of the baseline it compares against. Allowing a recovery attempt to recompute the baseline from a possibly-modified state would silently defeat the guarantee: a protected-table modification that occurred after the initial baseline capture but before the crash would be baked into the recovery baseline and would then compare equal to the post-migration digest, masking the very integrity violation that INVARIANT-19 exists to detect.

### 2.3 Migration and secret model

- Encryption keys are supplied via environment variables (`WEBHOOK_TOKEN_ENCRYPTION_KEYS`, `WEBHOOK_TOKEN_ENCRYPTION_ACTIVE_VERSION`, `META_CREDENTIAL_ENCRYPTION_KEYS`, `META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION`).
- Webhook verify tokens and Meta provider credentials use **distinct** key sets. A compromise of one MUST NOT affect the other.
- Process-local, TTL-bound, non-persistent volatile plaintext caches are permitted. Persistent or shared caches of plaintext secrets are prohibited.

### 2.4 Platform patterns

- **Transactional outbox is a platform-level primitive.** Every asynchronous side effect produced by a durable domain transition is enqueued through `outbox_jobs` inside the same PostgreSQL transaction that commits the domain state. No direct Redis enqueue is permitted on a durable-write hot path.
- **Inbound external events are append-oriented receipts.** The raw payload of an external event is immutable after receipt. Processing state is a narrow, explicitly modeled mutation.
- **Provider credentials are encrypted at rest with application-managed keys.** No plaintext secret is persisted in any ordinary application table, log, audit record, or cache beyond the minimum necessary in-memory lifetime of a single operation.
- **External identifiers are idempotency anchors.** Every inbound external event carries an `idempotency_key`; every outbound external side effect carries a deterministic `job_id`; every materialized external entity carries a natural external identifier enforced by a unique constraint or unique index.
- **Operational health is separated from configuration.** High-frequency health updates never rewrite relatively stable configuration data. This applies both to source endpoints (`source_endpoint_health`) and inbound webhook subscriptions (`webhook_subscription_health`).

### 2.5 Deployment and tenancy scope

DB v1.3.1 provides **multi-user access control within a shared deployment scope**. The `roles` and `users` tables support multiple authenticated users, and audit/history tables reference `user_id` / `actor_user_id`.

DB v1.3.1 does **not** provide tenant-, account-, workspace-, or organization-level data isolation. The following are explicitly out of scope:

- a `tenant_id`, `account_id`, `workspace_id`, or `owner_id` column on any core or supporting domain entity;
- row-level security policies that partition data by tenant;
- per-tenant destination, source, publication, or credential namespacing.

Deployment is the highest isolation boundary. All users within a deployment share the same domain state, subject to role-based access control.

If future requirements demand multi-tenant isolation, it must be introduced as a first-class architectural change with its own contract revision, not as an incremental column addition.

### 2.6 Allowed and forbidden transformations during the `0015`–`0018` migration

This section makes the boundary of INVARIANT-14 precise. Only the transformations listed as **Allowed** may change a durable business row, a schema object, or a ciphertext during the migration window. Everything listed as **Forbidden** is a contract violation.

| Allowed (explicit transformations)                                      | Forbidden (contract violations)                                                                                                                                                                 |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webhook_subscriptions.endpoint_id` backfill from deployment config     | Deleting any durable business row                                                                                                                                                               |
| `external_interactions.provider = 'META'` backfill for legacy rows      | Rewriting `publications`, `publication_attempts`, or `publication_reconciliations` payloads                                                                                                     |
| Legacy → endpoint ciphertext re-encryption (additive; legacy preserved) | Regenerating any business result that was already persisted                                                                                                                                     |
| `webhook_endpoints` row creation for the deployment's App               | Modifying existing business payload columns                                                                                                                                                     |
| `external_interactions_provider_external_id_uq` unique index build      | Modifying existing business natural keys other than `external_interactions`                                                                                                                     |
| Transitional nullable column addition (`endpoint_id`, `provider`)       | Replacing the existing database with a greenfield baseline                                                                                                                                      |
| Transitional `NOT NULL` addition in `0018` after Hard Gate #2           | Altering column types of durable business columns                                                                                                                                               |
| Bridge dual-write of new/rotated tokens                                 | Writing `DESTINATION` credentials into `APP` scope or vice versa                                                                                                                                |
| Endpoint ciphertext write on Bridge/rotation                            | Changing any row in `webhook_deliveries`, `interaction_response_attempts`, `interaction_moderation_actions`, or `interaction_response_reconciliations` other than via their normal append paths |
| Adding indexes listed in §8                                             | Dropping or renaming indexes not listed in `0018 CONTRACT`                                                                                                                                      |
| Computed preservation-evidence digests written to `audit_logs`          | Any reduction of the protected-table set in §2.2                                                                                                                                                |
| Immutable preservation-baseline records written to `audit_logs`         | Modifying, deleting, or superseding an immutable preservation-baseline record (INVARIANT-22)                                                                                                    |

Every migration step MUST be audit-testable against this matrix. Any transformation that does not appear in the **Allowed** column and appears in the **Forbidden** column MUST abort the migration.

### 2.7 Preservation evidence and content-level verification

INVARIANT-14 ("byte-for-byte preservation") is interpreted as follows.

- "Preservation" applies to the **values of durable business columns** in the protected tables listed in §2.2. It does not extend to PostgreSQL internal storage representation: MVCC metadata, page layout, TOAST row contents, index physical layout, and free-space maps are outside the scope of the guarantee.
- A row is "preserved" if and only if, for every column not listed as Allowed in §2.6, the post-migration value equals the pre-migration value.
- For columns listed as Allowed in §2.6 (for example `endpoint_id`, `provider`, `verify_token_encrypted`, `verify_token_key_version`, `last_rotated_at`), the migration MAY alter the value. In that case, the preservation guarantee does not apply to those specific columns, but MUST still apply to every other column of the same row.
- Verification is performed via the SHA-256 content-level digest defined in INVARIANT-19 and §2.8. A migration that satisfies the SQL-level rules in §20 but fails the digest comparison is a contract violation.
- The digest comparison MUST use the **immutably persisted pre-migration baseline** (INVARIANT-22), never a recomputed baseline. The post-migration digest MUST be recorded together with the immutable baseline reference.
- The digest MUST be recorded in `audit_logs` with `action = 'PRESERVATION_EVIDENCE'`, `entity_type = 'MIGRATION'`, `entity_id = NULL`, and `metadata` containing at minimum `{ table, pre_digest, post_digest, pre_row_count, post_row_count, excluded_columns, baseline_audit_id }` for each protected table, where `baseline_audit_id` is the `audit_logs.id` of the corresponding `PRESERVATION_BASELINE_CAPTURED` record.

This interpretation is normative. Any reading of "byte-for-byte preservation" that omits content-level verification against the immutable baseline MUST be rejected.

### 2.8 Canonical-JSON preservation digest specification

This section is a normative implementation specification for the digest referenced by INVARIANT-19 and §2.7. It is binding on every conformance implementation of `0016 MIGRATE`.

#### 2.8.1 Serialization model

The digest is computed over a deterministic serialization of the protected table's rows. The serialization MUST be byte-identical across any two implementations that claim conformance, given the same pre-migration data.

The serialization is the JSON Lines form:

```text
<canonical_json_object_row_1>\n
<canonical_json_object_row_2>\n
...
<canonical_json_object_row_N>\n
```

Each row is serialized as a canonical JSON object. The trailing newline after every row (including the last) is mandatory.

The digest is computed as `SHA-256` over the UTF-8 bytes of the serialization.

#### 2.8.2 Column set

The selected columns are:

```text
all columns of the table
EXCEPT
any column listed as Allowed in §2.6 that is present on that table
```

The excluded columns for the protected tables in v1.3.1 are:

| Table                                  | Excluded (Allowed) columns           |
| -------------------------------------- | ------------------------------------ |
| `webhook_subscriptions`                | not protected; not in the digest set |
| `webhook_endpoints`                    | not protected; not in the digest set |
| `external_interactions`                | not protected; not in the digest set |
| `publications`                         | (none)                               |
| `publication_attempts`                 | (none)                               |
| `publication_reconciliations`          | (none)                               |
| `webhook_events`                       | (none)                               |
| `webhook_deliveries`                   | (none)                               |
| `provider_credentials`                 | (none)                               |
| `interaction_responses`                | (none)                               |
| `interaction_response_attempts`        | (none)                               |
| `interaction_moderation_actions`       | (none)                               |
| `interaction_response_reconciliations` | (none)                               |
| `outbox_jobs`                          | (none)                               |

The excluded-column set for a protected table is fixed at the time this contract is issued. Any change requires a contract revision.

#### 2.8.3 Row ordering

Rows MUST be ordered by the table's primary key, in ascending order. Where the primary key is a composite, the composite order is defined by the column order in the primary key declaration. Where the primary key is a `uuid`, ordering is by the canonical string form of the UUID (lowercase hyphenated hexadecimal), lexicographically ascending.

If the primary key is not suitable as a stable total order (for example, if the primary key is not unique — which is forbidden by this contract — or if the table has no primary key — which is also forbidden by this contract), the migration MUST abort. The digest algorithm does not permit fallback ordering.

#### 2.8.4 Key ordering within a row

Within each row's JSON object, keys MUST appear in the column order that PostgreSQL reports for the table in `information_schema.columns.ordinal_position`. This is the physical column order.

Keys MUST be serialized as JSON strings using double quotes.

#### 2.8.5 Value canonicalization

Values MUST be serialized according to the following rules:

- **`NULL`**: the JSON literal `null`.
- **`boolean`**: the JSON literals `true` or `false` (lowercase).
- **`integer`, `bigint`, `smallint`, `numeric`, `real`, `double precision`**: JSON number, serialized in the shortest form that round-trips exactly to the same value. For `numeric`, no exponent notation is permitted unless the value cannot be written in non-exponent decimal form without precision loss; in that case, the exponent form MUST be normalized to non-exponent. Trailing zeros after the decimal point MUST be preserved exactly as stored.
- **`text`, `varchar`, `char`**: JSON string, with all characters escaped according to RFC 8259. In particular, control characters MUST be escaped as `\uXXXX` with lowercase hex digits, and the double quote MUST be escaped as `\"`. The forward slash `/` MUST NOT be escaped. Unicode characters outside the Basic Multilingual Plane MUST be encoded as UTF-8 without surrogate pairs in the output.
- **`uuid`**: JSON string in lowercase hyphenated hexadecimal form, e.g. `"a1b2c3d4-e5f6-7890-abcd-ef1234567890"`.
- **`timestamptz`**: JSON string in RFC 3339 form with microsecond precision and UTC timezone offset, e.g. `"2026-10-05T14:22:31.123456+00:00"`. The offset MUST be `+00:00`, never `Z`. Trailing zeros in the fractional seconds MUST be preserved exactly as stored. If the value has no fractional seconds, the fraction MUST be omitted, e.g. `"2026-10-05T14:22:31+00:00"`.
- **`date`**: JSON string in ISO 8601 form, e.g. `"2026-10-05"`.
- **`time`**: JSON string in ISO 8601 form, e.g. `"14:22:31.123456"`. Fractional seconds follow the same rule as `timestamptz`.
- **`inet`**: JSON string in the canonical form PostgreSQL returns, e.g. `"192.0.2.1"` or `"2001:db8::1"`. IPv6 addresses MUST use the compressed form. IPv4-mapped IPv6 addresses MUST use the canonical IPv6 form.
- **`jsonb`**: JSON value, serialized in PostgreSQL's canonical `jsonb` output form. Concretely: object keys sorted lexicographically by UTF-8 byte order; duplicate keys resolved to the last value (matching PostgreSQL's `jsonb` semantics); insignificant whitespace removed; numbers in the shortest round-tripping form defined for the numeric type above; strings escaped as per RFC 8259 with the same rules as `text`.
- **`text[]` and other array types**: JSON array, serialized element-by-element using the element type's canonicalization. Element order is preserved exactly as stored. `NULL` elements are serialized as JSON `null`.
- **`bytea`**: JSON string, base64-encoded without padding, matching the output of `encode(col, 'base64')` followed by stripping the trailing `=`. For v1.3.1, no protected table stores a `bytea` column; this rule is defined for completeness.

If a protected table gains a column of a type not covered above, the contract MUST be revised before the column is added. Digest computation MUST NOT silently coerce the value.

#### 2.8.6 Row-count and empty-table handling

- For a non-empty table, the digest is computed over the serialization defined above, and the recorded row count is the number of rows serialized.
- For an empty table, the serialization is the empty byte string. The SHA-256 of the empty byte string is:

  ```text
  e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  ```

  The recorded row count is `0`. An empty table is not a special case: the digest algorithm is applied uniformly.

#### 2.8.7 Streaming for large tables

For tables whose serialized form does not fit comfortably in memory, implementations MUST use a streaming SHA-256 computation. The streamed byte sequence MUST be identical to the byte sequence of the in-memory serialization defined above. No per-row SHA-256 is permitted; the digest is over the entire serialization, not over a concatenation of per-row digests.

Implementations MUST NOT use a database-side `md5()` / `sha256()` aggregate that operates on a different serialization than the one defined above. If a database-side computation is used, it MUST be verified against an application-side streaming computation on a small sample before being trusted for the full-table digest.

#### 2.8.8 Digest record

For each protected table, the migration runner MUST write exactly one `PRESERVATION_EVIDENCE` row after Step 6 has passed:

```sql
INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
VALUES (
  'PRESERVATION_EVIDENCE',
  'MIGRATION',
  NULL,
  jsonb_build_object(
    'table',            :table_name,
    'pre_digest',       :sha256_hex_pre,
    'post_digest',      :sha256_hex_post,
    'pre_row_count',    :row_count_pre,
    'post_row_count',   :row_count_post,
    'excluded_columns', :excluded_columns_json,
    'baseline_audit_id',:baseline_audit_id
  )
);
```

Both `pre_digest` and `post_digest` are lowercase hex strings of length 64. `pre_digest` is copied verbatim from the immutable baseline record written by Step 1a (see §2.8.9). `baseline_audit_id` is the `audit_logs.id` of that immutable baseline record.

The migration runner MUST compare `pre_digest` and `post_digest` for every protected table and MUST abort if any differ, before writing the `PRESERVATION_EVIDENCE` record to `audit_logs`.

#### 2.8.9 Immutable pre-migration preservation baseline

This subsection specifies the immutable baseline capture required by INVARIANT-22.

**When.** The immutable baseline MUST be captured during `0016` Step 1a, before the first data modification of `0016` (Step 2) executes. The capture transaction MUST be committed before Step 2 begins.

**How.** For each protected table listed in INVARIANT-19, the migration runner computes the pre-migration digest using the canonical-JSON serialization defined in §2.8.1–§2.8.7, and writes one immutable baseline record:

```sql
INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
VALUES (
  'PRESERVATION_BASELINE_CAPTURED',
  'MIGRATION',
  NULL,
  jsonb_build_object(
    'table',            :table_name,
    'pre_digest',       :sha256_hex_pre,
    'pre_row_count',    :row_count_pre,
    'excluded_columns', :excluded_columns_json,
    'captured_at',      now(),
    'migration_run_id', :run_id
  )
);
```

All baseline rows for a single `0016` phase MUST be written inside a single transaction that commits atomically. The `migration_run_id` binds them to the specific `0016` phase that produced them.

**Immutability.** Once committed, a `PRESERVATION_BASELINE_CAPTURED` row MUST NOT be modified or deleted by any subsequent step, whether in the same `0016` run or in any recovery run. This is a contract-level constraint. It is enforced at the application layer, at code review, and by CI checks that assert no `UPDATE` or `DELETE` statement targets rows with `action = 'PRESERVATION_BASELINE_CAPTURED'`.

**Recovery semantics.** During recovery (see §20.2.8), the migration runner MUST NOT write a second `PRESERVATION_BASELINE_CAPTURED` set. It MUST locate the existing baseline records for the current `0016` phase and use them as the comparison target for Step 6. If no baseline records exist for the current `0016` phase, the runner MUST determine whether any `0016` data modification has been committed (see §20.2.8 step 3a). If no `0016` data modification has been committed, the runner MAY proceed with a fresh baseline capture. If any `0016` data modification has been committed, the runner MUST abort with a hard failure; a pre-migration baseline cannot be reconstructed after the fact.

**Binding to the post-migration comparison.** The `PRESERVATION_EVIDENCE` record written at Step 6 MUST reference the immutable baseline via `baseline_audit_id`. The `pre_digest` value in the `PRESERVATION_EVIDENCE` record MUST be byte-equal to the `pre_digest` value in the referenced baseline record. A conformance implementation MUST reject any `PRESERVATION_EVIDENCE` record whose `pre_digest` does not match its referenced baseline.

---

## 3. Table Inventory

DB v1.3.1 contains **45 persistence tables**, organized into seven categories.

### 3.1 Table count summary

```text
15  core logical model                   (DB v1 Logical Model Specification v1.0)
18  supporting platform persistence     (Platform Architecture)
 4  inbound event persistence           (v1.1)
 1  inbound health companion            (v1.2)
 1  webhook endpoint aggregate          (v1.3.1 — App-level endpoint root)
 5  provider credentials + response     (v1.1)
 1  platform pattern (outbox)           (v1.1)
---
45  total persistence tables
```

### 3.2 List of tables

**Core logical model (15):**
`sources`, `source_endpoints`, `source_endpoint_health`, `discovered_resources`, `discovery_observations`, `provenance_events`, `raw_resources`, `source_items`, `content_items`, `content_urls`, `content_versions`, `content_fingerprints`, `duplicate_matches`, `stories`, `story_members`.

**Supporting platform persistence (18):**
`roles`, `users`, `content_entities`, `content_categories`, `images`, `image_rights`, `destinations`, `publication_candidates`, `publications`, `publication_attempts`, `publication_reconciliations`, `moderation_actions`, `system_config`, `config_audit_log`, `ai_usage`, `system_logs`, `notifications`, `audit_logs`.

**Inbound & provider persistence (11):**
`webhook_endpoints`, `webhook_subscriptions`, `webhook_subscription_health`, `webhook_events`, `webhook_deliveries`, `external_interactions`, `provider_credentials`, `interaction_responses`, `interaction_response_attempts`, `interaction_moderation_actions`, `interaction_response_reconciliations`.

**Platform pattern primitive (1):**
`outbox_jobs`.

### 3.3 Removed legacy tables

The following legacy source-ingestion tables are **not part of DB v1**:

```text
source_cursors
source_health
```

Their responsibilities are replaced by endpoint-specific state and endpoint health. They must not be recreated as compatibility aliases in the DB v1 schema. Any compatibility logic belongs outside the production persistence model and must not create a second source of truth.

### 3.4 Architectural responsibility transfer

DB v1 deliberately moves technical ingestion state and operational health from the logical Source level to the technical SourceEndpoint level. This is a structural responsibility transfer, not merely a table rename or deletion.

```text
Legacy model            DB v1
Source                  Source
├── source_cursors      └── SourceEndpoint
└── source_health           ├── state + state_version
                            └── SourceEndpointHealth
```

The rationale is normative:

1. A Source represents a logical publisher, brand, or other content source. It must not carry technical state that may differ between access mechanisms.
2. A Source may expose multiple endpoints, and each endpoint may have independent incremental state. An RSS feed cursor, sitemap position, pagination cursor, or API token is therefore endpoint-specific.
3. Endpoint health is also endpoint-specific. Failure of one endpoint must not imply failure of the logical Source when another endpoint remains healthy.
4. Separating endpoint health from endpoint configuration prevents high-frequency operational updates from rewriting relatively stable endpoint configuration data.
5. `state_version` provides optimistic concurrency control for endpoint-specific incremental state and prevents concurrent workers from overwriting newer state.
6. `source_cursors` and source-level `source_health` must not be recreated as compatibility aliases in the DB v1 schema.

The `webhook_subscription_health` table applies the same separation principle to inbound webhook subscriptions.

---

## 4. Common Physical Conventions

### 4.1 Primary keys

Entity tables use:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
```

The `pgcrypto` extension is created by migration `0000` and is never re-declared.

Exception: `system_config`, whose primary key is the configuration key itself (text), not a surrogate UUID.

### 4.2 Timestamps

Temporal fields use `timestamptz`. Business timezone conversion belongs to application-level scheduling logic.

### 4.3 Text and enumerated values

Domain state values are stored as text. PostgreSQL enums are not used in DB v1. Where a vocabulary is finalized, `CHECK` constraints enforce it directly.

### 4.4 JSONB

`jsonb` is used for structurally variable data:

- source safety limits;
- endpoint configuration;
- endpoint state;
- discovery metadata;
- provenance-adjacent metadata where explicitly defined;
- publication reconciliation details;
- system configuration values;
- audit changes and metadata;
- operational log metadata;
- webhook raw payloads;
- interaction raw metadata;
- outbox job payloads.

JSONB must not be used to hide relational identity, foreign-key relationships, or fields that require normal indexed lookup.

### 4.5 Deletion and referential-action consistency

The default policy is to prefer lifecycle transitions such as `DISABLED`, `ARCHIVED`, or `TRASHED` over physical deletion.

Ownership-oriented operational artifacts may use cascade deletion where the logical model explicitly permits it. Durable business history and audit records must not be silently removed as a side effect of ordinary lifecycle operations.

**Referential-action consistency invariant (normative).** An `ON DELETE SET NULL` action MUST NOT be applied to a column declared `NOT NULL`. Every foreign key's referential action MUST be consistent with the referencing column's nullability. This invariant is enforced by PostgreSQL itself at DDL time, and this contract MUST NOT declare any combination that would fail at `CREATE TABLE` or `ALTER TABLE` time.

Concretely:

- `NOT NULL` referencing columns MUST use `ON DELETE RESTRICT` or `ON DELETE CASCADE`.
- `ON DELETE SET NULL` is permitted only when the referencing column is nullable.

### 4.6 Secrets

No plaintext secret is persisted in ordinary application tables. Secrets are stored only in:

- `provider_credentials.encrypted_value` (encrypted with `META_CREDENTIAL_ENCRYPTION_KEYS`)
- `webhook_endpoints.verify_token_encrypted` (encrypted with `WEBHOOK_TOKEN_ENCRYPTION_KEYS`)

The two key sets are distinct. A compromise of one MUST NOT affect the other.

**Key material format:**

```text
WEBHOOK_TOKEN_ENCRYPTION_KEYS={"1":"<base64-32-bytes>","2":"<base64-32-bytes>"}
WEBHOOK_TOKEN_ENCRYPTION_ACTIVE_VERSION=2

META_CREDENTIAL_ENCRYPTION_KEYS={"1":"<base64-32-bytes>"}
META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION=1
```

The legacy single-key format (`WEBHOOK_TOKEN_ENCRYPTION_KEY=<base64>`) is accepted for the v1.1/v1.2 compatibility window only. New setups MUST use the versioned format. See §5.34.

**Encryption algorithm:** AES-256-GCM. Ciphertext format: `v1:base64(iv ‖ ct ‖ tag)`.

**Key version column:** every encrypted row stores the version used to write it. This permits rotation without a full-table rewrite in a single transaction. The active write version is selected by `*_ACTIVE_VERSION`.

**AAD naming convention:**

Two AAD forms exist for webhook verify tokens. They are named distinctly and are never simultaneously authoritative:

- **Target-state authoritative AAD:**
  `META:WEBHOOK_VERIFY_TOKEN:<endpoint_id>`
  Used for all writes after `0017 SWITCH` and all reads after `0018 CONTRACT`.
- **Legacy migration-only AAD:**
  `META:WEBHOOK_VERIFY_TOKEN:<destination_id>`
  Used only during the `0015`–`0018` migration window by the Compatibility Bridge and by the `0016 MIGRATE` re-encryption step. It has no authority after `0018 CONTRACT` and MUST NOT be used by v1.3 application code.

### 4.7 Idempotency keys

Every deterministic business identity reproduced by a retry is expressed as a database-enforced uniqueness constraint or unique index:

- `webhook_events.idempotency_key`
- `outbox_jobs.job_id`
- `external_interactions(provider, external_interaction_id)`

The three-layer idempotency model:

```text
HTTP receipt (idempotency_key) → job ID (job_id) → domain natural key (provider, external_interaction_id)
```

Each layer is independently authoritative for its own boundary. No layer may be skipped or merged into another.

---

## 5. Table Contracts

The following sections detail all 45 tables. Each definition is complete and self-contained. Tables are ordered to reflect dependency ordering where practical; the authoritative dependency order for migration purposes is given in §19.

---

### 5.1 `roles`

Purpose: authenticated application roles.

`roles` is a supporting platform persistence table. It is intentionally outside the DB v1 Logical Model Specification because authentication and authorization schema are explicit non-goals of that document.

| Column        | Type        | Null | Default   | Constraint |
| ------------- | ----------- | ---: | --------- | ---------- |
| `id`          | uuid        |   no | generated | PK         |
| `name`        | text        |   no | —         | UNIQUE     |
| `description` | text        |  yes | —         | —          |
| `created_at`  | timestamptz |   no | now       | —          |

Canonical role names:

```text
VIEWER
EDITOR
PUBLISHER
ADMIN
```

---

### 5.2 `users`

Purpose: authenticated application users.

| Column          | Type        | Null | Default   | Constraint      |
| --------------- | ----------- | ---: | --------- | --------------- |
| `id`            | uuid        |   no | generated | PK              |
| `email`         | text        |   no | —         | UNIQUE          |
| `password_hash` | text        |   no | —         | —               |
| `display_name`  | text        |   no | —         | —               |
| `role_id`       | uuid        |   no | —         | FK → `roles.id` |
| `is_active`     | boolean     |   no | true      | —               |
| `created_at`    | timestamptz |   no | now       | —               |
| `updated_at`    | timestamptz |   no | now       | —               |

Plaintext passwords are prohibited.

Users are scoped to a single deployment. See §2.5 for the tenancy boundary.

---

### 5.3 `sources`

Purpose: logical publisher, brand, or other content source.

A Source is **not** a technical endpoint. Endpoint-specific access information belongs to `source_endpoints`.

| Column             | Type        | Null | Default   | Constraint                       |
| ------------------ | ----------- | ---: | --------- | -------------------------------- |
| `id`               | uuid        |   no | generated | PK                               |
| `name`             | text        |   no | —         | UNIQUE                           |
| `status`           | varchar(32) |   no | —         | `ACTIVE`, `PAUSED`, `DISABLED`   |
| `reputation_state` | varchar(32) |   no | —         | `VERIFIED`, `NEUTRAL`, `FLAGGED` |
| `priority`         | integer     |   no | 100       | —                                |
| `safety_limits`    | jsonb       |   no | `{}`      | —                                |
| `created_at`       | timestamptz |   no | now       | —                                |
| `updated_at`       | timestamptz |   no | now       | —                                |

`type` and `url` are intentionally absent. They are endpoint properties and therefore belong to `source_endpoints`.

Relationships:

```text
sources 1:N source_endpoints
sources 1:N source_items
```

---

### 5.4 `source_endpoints`

Purpose: concrete technical access point belonging to a Source.

One Source may expose multiple endpoints for different discovery, acquisition, and extraction strategies.

| Column           | Type        | Null | Default                | Constraint                         |
| ---------------- | ----------- | ---: | ---------------------- | ---------------------------------- |
| `id`             | uuid        |   no | generated              | PK                                 |
| `source_id`      | uuid        |   no | —                      | FK → `sources.id`                  |
| `representation` | varchar(32) |   no | —                      | `XML`, `HTML`, `JSON`, `UNKNOWN`   |
| `capabilities`   | text[]      |   no | —                      | domain-validated capability values |
| `url`            | text        |   no | —                      | —                                  |
| `status`         | varchar(32) |   no | —                      | `ACTIVE`, `PAUSED`, `DISABLED`     |
| `next_poll_at`   | timestamptz |   no | now                    | —                                  |
| `state_version`  | integer     |   no | 0                      | `>= 0`                             |
| `state`          | jsonb       |   no | `{"kind":"STATELESS"}` | discriminated endpoint state       |
| `created_at`     | timestamptz |   no | now                    | —                                  |
| `updated_at`     | timestamptz |   no | now                    | —                                  |

Unique constraint:

```text
(source_id, url)
```

Representation values:

```text
XML
HTML
JSON
UNKNOWN
```

Capabilities are drawn from:

```text
DISCOVERY
ACQUISITION
EXTRACTION
```

#### Endpoint state

`state` is the persisted representation of the polymorphic `EndpointState` model.

The JSON object contains a discriminator:

```text
kind
```

Supported logical kinds:

```text
FEED
SITEMAP
PAGINATION
API
STATELESS
```

Examples of state-specific values include:

```text
lastItemId
lastPublishedAt
lastHash
lastSeenUrl
lastModified
pageCursor
nextPageToken
lastOffset
```

The database does not flatten these fields into a fixed set of nullable columns. The state shape is polymorphic and may evolve as additional endpoint strategies are introduced. Every persisted state must contain the `kind` discriminator and conform to the corresponding logical endpoint-state variant.

#### Optimistic locking

`state_version` provides optimistic concurrency control.

A worker may update endpoint state only if the persisted `state_version` still equals the version observed when the worker read the endpoint.

A successful update increments `state_version`.

#### Scheduler index

The scheduler must be able to efficiently select due active endpoints:

```text
(status, next_poll_at)
```

---

### 5.5 `source_endpoint_health`

Purpose: operational health extension for a SourceEndpoint.

The table is a strict 1:1 extension of `source_endpoints`.

| Column                 | Type        | Null | Default | Constraint                                       |
| ---------------------- | ----------- | ---: | ------- | ------------------------------------------------ |
| `endpoint_id`          | uuid        |   no | —       | PK, FK → `source_endpoints.id` ON DELETE CASCADE |
| `consecutive_failures` | integer     |   no | 0       | `>= 0`                                           |
| `last_success_at`      | timestamptz |  yes | —       | —                                                |
| `last_failure_at`      | timestamptz |  yes | —       | —                                                |
| `last_error_category`  | varchar(64) |  yes | —       | —                                                |
| `last_error_message`   | text        |  yes | —       | —                                                |
| `items_today`          | integer     |   no | 0       | `>= 0`                                           |
| `updated_at`           | timestamptz |   no | now     | —                                                |

`items_today` provides database-backed endpoint operational counter state. The application/transaction layer defines the reset and limit-enforcement semantics.

Health is intentionally separated from endpoint configuration and endpoint state so high-frequency operational updates do not require rewriting endpoint configuration data.

The health record is removed with its owning endpoint when an endpoint is intentionally deleted.

Index: `(last_failure_at)`.

---

### 5.6 `discovered_resources`

Purpose: canonical candidate identity created by discovery.

A DiscoveredResource represents a candidate resource independently of the observation path that found it.

| Column          | Type        | Null | Default   | Constraint |
| --------------- | ----------- | ---: | --------- | ---------- |
| `id`            | uuid        |   no | generated | PK         |
| `canonical_url` | text        |   no | —         | UNIQUE     |
| `external_id`   | text        |  yes | —         | —          |
| `published_at`  | timestamptz |  yes | —         | —          |
| `metadata`      | jsonb       |   no | `{}`      | —          |
| `created_at`    | timestamptz |   no | now       | —          |
| `updated_at`    | timestamptz |   no | now       | —          |

`canonical_url` is the normalized candidate identity and is unique at this layer.

Multiple endpoints discovering the same normalized URL reference the same `discovered_resources` row.

Index: `(published_at)`.

---

### 5.7 `discovery_observations`

Purpose: immutable record of an individual discovery of a DiscoveredResource through a SourceEndpoint.

| Column                   | Type        | Null | Default   | Constraint                                       |
| ------------------------ | ----------- | ---: | --------- | ------------------------------------------------ |
| `id`                     | uuid        |   no | generated | PK                                               |
| `discovered_resource_id` | uuid        |   no | —         | FK → `discovered_resources.id` ON DELETE CASCADE |
| `endpoint_id`            | uuid        |   no | —         | FK → `source_endpoints.id` ON DELETE CASCADE     |
| `external_id`            | text        |  yes | —         | —                                                |
| `published_at`           | timestamptz |  yes | —         | —                                                |
| `metadata`               | jsonb       |   no | `{}`      | —                                                |
| `observed_at`            | timestamptz |   no | now       | —                                                |

The Source is derived through:

```text
discovery_observations.endpoint_id
    → source_endpoints.source_id
    → sources.id
```

`source_id` is therefore not duplicated in this table.

Observations are immutable detection records. There is no `updated_at`.

Indexes: `(discovered_resource_id)`, `(endpoint_id, observed_at)`.

---

### 5.8 `provenance_events`

Purpose: immutable cross-cutting lineage log.

| Column               | Type         | Null | Default   | Constraint                                       |
| -------------------- | ------------ | ---: | --------- | ------------------------------------------------ |
| `id`                 | uuid         |   no | generated | PK                                               |
| `target_entity_type` | varchar(64)  |   no | —         | domain-validated                                 |
| `target_entity_id`   | uuid         |   no | —         | polymorphic target identifier                    |
| `endpoint_id`        | uuid         |  yes | —         | FK → `source_endpoints.id`, `ON DELETE SET NULL` |
| `phase`              | varchar(32)  |   no | —         | `DISCOVERY`, `ACQUISITION`, `EXTRACTION`         |
| `method`             | varchar(64)  |   no | —         | phase-compatible operation method                |
| `artifact_hash`      | varchar(128) |  yes | —         | optional integrity value                         |
| `observed_at`        | timestamptz  |   no | now       | —                                                |

Target entity types:

```text
DISCOVERED_RESOURCE
RAW_RESOURCE
SOURCE_ITEM
CONTENT_ITEM
CONTENT_VERSION
```

The target is intentionally represented by:

```text
target_entity_type + target_entity_id
```

because provenance spans multiple artifact types. A polymorphic target cannot be represented by a conventional PostgreSQL foreign key without sacrificing the multi-target model.

The endpoint reference is nullable so provenance can survive intentional endpoint deletion where required.

Provenance events are immutable. There is no `updated_at`.

Indexes: `(target_entity_type, target_entity_id)`, `(endpoint_id, observed_at)`.

---

### 5.9 `raw_resources`

Purpose: raw acquisition artifact retained for diagnostics, retries, auditability, and re-extraction.

| Column                   | Type         | Null | Default   | Constraint                                       |
| ------------------------ | ------------ | ---: | --------- | ------------------------------------------------ |
| `id`                     | uuid         |   no | generated | PK                                               |
| `discovered_resource_id` | uuid         |   no | —         | FK → `discovered_resources.id` ON DELETE CASCADE |
| `url`                    | text         |   no | —         | —                                                |
| `content_type`           | varchar(128) |   no | —         | —                                                |
| `body`                   | text         |   no | —         | raw payload representation                       |
| `fetched_at`             | timestamptz  |   no | now       | —                                                |

One DiscoveredResource may have multiple RawResource snapshots.

A failed acquisition that does not produce a raw artifact does not require a `raw_resources` row.

The acquisition event itself is represented through provenance and operational execution infrastructure rather than through a separate canonical worker-attempt entity.

There is no `updated_at`.

Index: `(discovered_resource_id, fetched_at)`.

---

### 5.10 `source_items`

Purpose: structured extraction result before platform-level normalization.

| Column            | Type        | Null | Default   | Constraint                                 |
| ----------------- | ----------- | ---: | --------- | ------------------------------------------ |
| `id`              | uuid        |   no | generated | PK                                         |
| `source_id`       | uuid        |   no | —         | FK → `sources.id` ON DELETE CASCADE        |
| `source_item_id`  | text        |   no | —         | UNIQUE with `source_id`                    |
| `source_url`      | text        |   no | —         | —                                          |
| `title`           | text        |   no | —         | —                                          |
| `description`     | text        |  yes | —         | —                                          |
| `content`         | text        |   no | —         | —                                          |
| `author`          | text        |  yes | —         | —                                          |
| `language`        | text        |  yes | —         | —                                          |
| `published_at`    | timestamptz |  yes | —         | —                                          |
| `discovered_at`   | timestamptz |   no | now       | —                                          |
| `raw_resource_id` | uuid        |  yes | —         | FK → `raw_resources.id` ON DELETE SET NULL |
| `content_item_id` | uuid        |  yes | —         | FK → `content_items.id` ON DELETE SET NULL |

Unique constraint:

```text
(source_id, source_item_id)
```

`raw_resource_id` is nullable because inline extraction may not require acquisition.

`content_item_id` is nullable until normalization maps the SourceItem to canonical platform content.

There is no `updated_at` because SourceItems are not edited in place.

Indexes: `(source_id, discovered_at)`, `(content_item_id)`.

---

### 5.11 `content_items`

Purpose: platform-level canonical content identity.

A ContentItem is independent of any single SourceItem, source endpoint, or discovery URL.

| Column               | Type        | Null | Default   | Constraint                                    |
| -------------------- | ----------- | ---: | --------- | --------------------------------------------- |
| `id`                 | uuid        |   no | generated | PK                                            |
| `canonical_url`      | text        |   no | —         | UNIQUE                                        |
| `status`             | varchar(32) |   no | —         | `DRAFT`, `PUBLISHED`, `ARCHIVED`, `TRASHED`   |
| `published_at`       | timestamptz |  yes | —         | —                                             |
| `current_version_id` | uuid        |  yes | —         | FK → `content_versions.id` ON DELETE SET NULL |
| `created_at`         | timestamptz |   no | now       | —                                             |
| `updated_at`         | timestamptz |   no | now       | —                                             |

The canonical URL belongs to the canonical content identity layer.

Source-specific identity is not stored directly on `content_items`; source lineage is retained through `source_items`, provenance, and related pipeline artifacts.

Historical canonical representations are stored in `content_versions`.

Index: `(status, published_at)`.

#### Mutual FK with `content_versions`

Because `content_items.current_version_id` and `content_versions.content_item_id` form a mutual dependency, migration creation must create the content tables first and add the `current_version_id` foreign key after `content_versions` exists. Drizzle resolves this through a lazy callback and generates the `ALTER TABLE ... ADD CONSTRAINT` statement in the same migration.

---

### 5.12 `content_urls`

Purpose: map alternate URLs to a canonical ContentItem.

| Column            | Type        | Null | Default   | Constraint                                |
| ----------------- | ----------- | ---: | --------- | ----------------------------------------- |
| `id`              | uuid        |   no | generated | PK                                        |
| `content_item_id` | uuid        |   no | —         | FK → `content_items.id` ON DELETE CASCADE |
| `url`             | text        |   no | —         | UNIQUE across platform                    |
| `url_kind`        | varchar(32) |   no | —         | `ALIAS`, `AMP`, `TRACKING_VARIANT`        |

The canonical URL itself is owned by `content_items.canonical_url` and is not duplicated as a `CANONICAL` row in `content_urls`.

The global uniqueness of `url` prevents one alternate URL from being assigned to multiple ContentItems.

Index: `(content_item_id)`.

---

### 5.13 `content_versions`

Purpose: immutable normalized representation of a ContentItem at a particular processing revision.

| Column               | Type        | Null | Default   | Constraint                                |
| -------------------- | ----------- | ---: | --------- | ----------------------------------------- |
| `id`                 | uuid        |   no | generated | PK                                        |
| `content_item_id`    | uuid        |   no | —         | FK → `content_items.id` ON DELETE CASCADE |
| `version_number`     | integer     |   no | —         | `> 0`, UNIQUE with content item           |
| `title`              | text        |   no | —         | —                                         |
| `content`            | text        |   no | —         | —                                         |
| `processing_version` | varchar(64) |   no | —         | —                                         |
| `created_at`         | timestamptz |   no | now       | —                                         |

Unique constraint:

```text
(content_item_id, version_number)
```

`version_number > 0`.

Versions are immutable after creation. There is no `updated_at`.

Index: `(content_item_id, version_number DESC)`.

---

### 5.14 `content_entities`

Purpose: extracted named or typed entities associated with canonical content.

| Column             | Type         | Null | Default   | Constraint                                |
| ------------------ | ------------ | ---: | --------- | ----------------------------------------- |
| `id`               | uuid         |   no | generated | PK                                        |
| `content_id`       | uuid         |   no | —         | FK → `content_items.id` ON DELETE CASCADE |
| `entity_type`      | text         |   no | —         | —                                         |
| `entity_value`     | text         |   no | —         | —                                         |
| `normalized_value` | text         |  yes | —         | —                                         |
| `confidence`       | numeric(5,4) |  yes | —         | `0..1`                                    |
| `created_at`       | timestamptz  |   no | now       | —                                         |

No fixed entity taxonomy is introduced in DB v1.

Index: `(content_id)`.

---

### 5.15 `content_categories`

Purpose: category assignments for canonical content.

| Column       | Type         | Null | Default   | Constraint                                |
| ------------ | ------------ | ---: | --------- | ----------------------------------------- |
| `id`         | uuid         |   no | generated | PK                                        |
| `content_id` | uuid         |   no | —         | FK → `content_items.id` ON DELETE CASCADE |
| `category`   | text         |   no | —         | —                                         |
| `confidence` | numeric(5,4) |  yes | —         | `0..1`                                    |
| `created_at` | timestamptz  |   no | now       | —                                         |

Category vocabulary remains domain/configuration-defined.

Index: `(content_id)`.

---

### 5.16 `content_fingerprints`

Purpose: structural fingerprints used by duplicate detection.

| Column              | Type         | Null | Default   | Constraint                                |
| ------------------- | ------------ | ---: | --------- | ----------------------------------------- |
| `id`                | uuid         |   no | generated | PK                                        |
| `content_item_id`   | uuid         |   no | —         | FK → `content_items.id` ON DELETE CASCADE |
| `algorithm`         | varchar(64)  |   no | —         | —                                         |
| `fingerprint_value` | varchar(512) |   no | —         | —                                         |
| `normalized_length` | integer      |   no | —         | —                                         |
| `created_at`        | timestamptz  |   no | now       | —                                         |

Initial logical algorithm vocabulary:

```text
SHA256
SIMHASH
MINHASH
EMBEDDING
```

The exact physical representation of an embedding fingerprint may require a later physical specialization. DB v1 must not assume that all algorithms have identical storage semantics beyond the contract above.

Unique constraint:

```text
(content_item_id, algorithm, fingerprint_value)
```

The primary lookup index is:

```text
(algorithm, fingerprint_value)
```

---

### 5.17 `duplicate_matches`

Purpose: preserve evidence that two distinct ContentItems represent duplicate or substantially equivalent content.

| Column              | Type        | Null | Default   | Constraint                                |
| ------------------- | ----------- | ---: | --------- | ----------------------------------------- |
| `id`                | uuid        |   no | generated | PK                                        |
| `canonical_item_id` | uuid        |   no | —         | FK → `content_items.id` ON DELETE CASCADE |
| `duplicate_item_id` | uuid        |   no | —         | FK → `content_items.id` ON DELETE CASCADE |
| `similarity_score`  | real        |   no | —         | `0.0..1.0`                                |
| `detection_method`  | varchar(64) |   no | —         | —                                         |
| `created_at`        | timestamptz |   no | now       | —                                         |

Invariants:

```text
0.0 <= similarity_score <= 1.0
canonical_item_id != duplicate_item_id
```

Unique constraint:

```text
(canonical_item_id, duplicate_item_id, detection_method)
```

The relationship preserves detection evidence separately from the canonical identity decision.

Reciprocal uniqueness for the same pair is an **application-level invariant** (see §24, D-017). A `CHECK (canonical_item_id < duplicate_item_id)` would prevent recording the detection direction, and detection direction is meaningful evidence. The service layer is responsible for enforcing pair symmetry where required.

---

### 5.18 `stories`

Purpose: thematic grouping of related canonical ContentItems.

| Column       | Type        | Null | Default   | Constraint                                |
| ------------ | ----------- | ---: | --------- | ----------------------------------------- |
| `id`         | uuid        |   no | generated | PK                                        |
| `title`      | text        |   no | —         | —                                         |
| `summary`    | text        |  yes | —         | —                                         |
| `status`     | varchar(32) |   no | —         | `FORMING`, `ACTIVE`, `ARCHIVED`, `LOCKED` |
| `created_at` | timestamptz |   no | now       | —                                         |
| `updated_at` | timestamptz |   no | now       | —                                         |

Stories are independent of Source identity.

Index: `(status, updated_at)`.

---

### 5.19 `story_members`

Purpose: explicit N:M relationship between Stories and ContentItems.

| Column              | Type        | Null | Default   | Constraint                                |
| ------------------- | ----------- | ---: | --------- | ----------------------------------------- |
| `id`                | uuid        |   no | generated | PK                                        |
| `story_id`          | uuid        |   no | —         | FK → `stories.id` ON DELETE CASCADE       |
| `content_item_id`   | uuid        |   no | —         | FK → `content_items.id` ON DELETE CASCADE |
| `relevance_score`   | real        |   no | —         | `0.0..1.0`                                |
| `membership_type`   | varchar(32) |   no | —         | `PRIMARY`, `MENTIONED`                    |
| `assignment_method` | varchar(32) |   no | —         | `AUTOMATIC`, `MANUAL`                     |
| `added_at`          | timestamptz |   no | now       | —                                         |

Unique constraint:

```text
(story_id, content_item_id)
```

A ContentItem may participate in multiple Stories. DB v1 does not impose a global one-story-only constraint because the finalized logical model explicitly defines an N:M relationship.

There is no `updated_at` because membership rows are immutable after insert.

Indexes: `(story_id, added_at)`, `(content_item_id)`.

---

### 5.20 `images`

Purpose: image discovery, resolution, and validation artifacts associated with content.

| Column            | Type        | Null | Default   | Constraint                                 |
| ----------------- | ----------- | ---: | --------- | ------------------------------------------ |
| `id`              | uuid        |   no | generated | PK                                         |
| `content_id`      | uuid        |  yes | —         | FK → `content_items.id` ON DELETE SET NULL |
| `source_url`      | text        |   no | —         | —                                          |
| `resolved_url`    | text        |  yes | —         | —                                          |
| `mime_type`       | text        |  yes | —         | —                                          |
| `width`           | integer     |  yes | —         | `> 0`                                      |
| `height`          | integer     |  yes | —         | `> 0`                                      |
| `file_size_bytes` | bigint      |  yes | —         | `>= 0`                                     |
| `status`          | text        |   no | —         | domain-validated                           |
| `created_at`      | timestamptz |   no | now       | —                                          |

`content_id` is nullable with `ON DELETE SET NULL`: an image may outlive its originating content item for rights and forensic purposes.

The final image status vocabulary remains outside DB v1 logical-model scope (deferred decision D-002).

There is no `updated_at`.

Indexes: `(content_id)`, `(status)`.

---

### 5.21 `image_rights`

Purpose: rights and attribution evaluation for an image.

| Column                 | Type        | Null | Default   | Constraint                                 |
| ---------------------- | ----------- | ---: | --------- | ------------------------------------------ |
| `id`                   | uuid        |   no | generated | PK                                         |
| `image_id`             | uuid        |   no | —         | UNIQUE, FK → `images.id` ON DELETE CASCADE |
| `rights_status`        | text        |   no | —         | domain-validated                           |
| `source_domain`        | text        |  yes | —         | —                                          |
| `attribution_required` | boolean     |   no | false     | —                                          |
| `attribution_text`     | text        |  yes | —         | —                                          |
| `evaluated_at`         | timestamptz |   no | now       | —                                          |

The exact rights taxonomy remains outside DB v1 logical-model scope (deferred decision D-003).

---

### 5.22 `destinations`

Purpose: persistent identity and lifecycle for an external publication destination.

| Column        | Type        | Null | Default   | Constraint         |
| ------------- | ----------- | ---: | --------- | ------------------ |
| `id`          | uuid        |   no | generated | PK                 |
| `name`        | text        |   no | —         | —                  |
| `type`        | text        |   no | —         | domain-validated   |
| `external_id` | text        |   no | —         | UNIQUE with `type` |
| `is_active`   | boolean     |   no | true      | —                  |
| `created_at`  | timestamptz |   no | now       | —                  |
| `updated_at`  | timestamptz |   no | now       | —                  |

Unique constraint:

```text
(type, external_id)
```

Credentials are not stored as plaintext in this table.

---

### 5.23 `publication_candidates`

Purpose: persisted editorial publication candidate.

| Column              | Type        | Null | Default   | Constraint                                |
| ------------------- | ----------- | ---: | --------- | ----------------------------------------- |
| `id`                | uuid        |   no | generated | PK                                        |
| `content_id`        | uuid        |   no | —         | FK → `content_items.id` ON DELETE CASCADE |
| `story_id`          | uuid        |   no | —         | FK → `stories.id` ON DELETE CASCADE       |
| `version`           | integer     |   no | —         | `> 0`                                     |
| `title`             | text        |   no | —         | —                                         |
| `caption`           | text        |   no | —         | —                                         |
| `summary`           | text        |   no | —         | —                                         |
| `source_url`        | text        |   no | —         | —                                         |
| `image_id`          | uuid        |  yes | —         | FK → `images.id` ON DELETE SET NULL       |
| `validation_status` | text        |   no | —         | `PASS`, `FAIL`, `REVIEW`                  |
| `created_at`        | timestamptz |   no | now       | —                                         |

The candidate stores the content representation intended for publication and is independent from transient worker execution state.

There is no `updated_at` because a candidate is a versioned artifact and edits produce new candidates.

Indexes: `(content_id)`, `(story_id)`, `(validation_status)`.

---

### 5.24 `moderation_actions`

Purpose: durable moderation decision history.

| Column         | Type        | Null | Default   | Constraint                                          |
| -------------- | ----------- | ---: | --------- | --------------------------------------------------- |
| `id`           | uuid        |   no | generated | PK                                                  |
| `content_id`   | uuid        |   no | —         | FK → `content_items.id` ON DELETE CASCADE           |
| `candidate_id` | uuid        |  yes | —         | FK → `publication_candidates.id` ON DELETE SET NULL |
| `user_id`      | uuid        |   no | —         | FK → `users.id` ON DELETE RESTRICT                  |
| `action`       | text        |   no | —         | domain-validated                                    |
| `reason`       | text        |  yes | —         | —                                                   |
| `created_at`   | timestamptz |   no | now       | —                                                   |

Canonical actions include:

```text
APPROVE
REJECT
EDIT
ARCHIVE
```

There is no `updated_at`. Moderation records are append-only.

Indexes: `(content_id, created_at)`, `(candidate_id)`, `(user_id, created_at)`.

---

### 5.25 `publications`

Purpose: durable publication intent and external publication state.

| Column                     | Type        | Null | Default     | Constraint                                          |
| -------------------------- | ----------- | ---: | ----------- | --------------------------------------------------- |
| `id`                       | uuid        |   no | generated   | PK                                                  |
| `publication_candidate_id` | uuid        |   no | —           | FK → `publication_candidates.id` ON DELETE RESTRICT |
| `destination_id`           | uuid        |   no | —           | FK → `destinations.id` ON DELETE RESTRICT           |
| `status`                   | text        |   no | `SCHEDULED` | domain-validated                                    |
| `scheduled_at`             | timestamptz |  yes | —           | —                                                   |
| `published_at`             | timestamptz |  yes | —           | —                                                   |
| `external_post_id`         | text        |  yes | —           | —                                                   |
| `created_at`               | timestamptz |   no | now         | —                                                   |
| `updated_at`               | timestamptz |   no | now         | —                                                   |

Publication states:

```text
SCHEDULED
RESERVED
IN_PROGRESS
PUBLISHED
RETRY
FAILED
RECONCILIATION
```

Publication identity must be deterministic at the candidate/content plus destination level. The application lock key is:

```text
publication:{contentId}:{destinationId}
```

A final unique constraint must enforce the same business identity once the publication-candidate/content relationship is resolved by the application model.

Unknown external outcomes must be representable and must not automatically become ordinary failures.

Indexes: `(status)`, `(scheduled_at)`, and the hot-path partial index:

```sql
CREATE INDEX publications_external_post_id_idx
  ON publications(external_post_id)
  WHERE external_post_id IS NOT NULL;
```

`external_post_id` is the natural lookup key for the webhook processing pipeline. The partial index serves that hot path without indexing the majority-null rows.

**No unique constraint on `external_post_id`.** `external_post_id` represents a historical external identifier that may legitimately repeat if an external post is deleted and re-created by the provider.

---

### 5.26 `publication_attempts`

Purpose: durable publication execution history.

This table is a business-history table for publication side effects. It is not a generic worker execution log and does not duplicate BullMQ retry metadata.

| Column             | Type        | Null | Default   | Constraint                               |
| ------------------ | ----------- | ---: | --------- | ---------------------------------------- |
| `id`               | uuid        |   no | generated | PK                                       |
| `publication_id`   | uuid        |   no | —         | FK → `publications.id` ON DELETE CASCADE |
| `attempt_number`   | integer     |   no | —         | `> 0`, UNIQUE with publication           |
| `status`           | text        |   no | —         | domain-validated                         |
| `started_at`       | timestamptz |  yes | —         | —                                        |
| `finished_at`      | timestamptz |  yes | —         | —                                        |
| `error_category`   | text        |  yes | —         | —                                        |
| `error_message`    | text        |  yes | —         | —                                        |
| `external_post_id` | text        |  yes | —         | —                                        |
| `created_at`       | timestamptz |   no | now       | —                                        |

Unique constraint:

```text
(publication_id, attempt_number)
```

Status vocabulary: `PENDING`, `SUCCESS`, `RETRY`, `FAILED`, `DEAD_LETTER`, `UNKNOWN`.

Index: `(status)`.

There is no `updated_at`.

---

### 5.27 `publication_reconciliations`

Purpose: durable investigation of uncertain external publication outcomes.

| Column             | Type        | Null | Default   | Constraint                                        |
| ------------------ | ----------- | ---: | --------- | ------------------------------------------------- |
| `id`               | uuid        |   no | generated | PK                                                |
| `publication_id`   | uuid        |   no | —         | FK → `publications.id` ON DELETE CASCADE          |
| `attempt_id`       | uuid        |  yes | —         | FK → `publication_attempts.id` ON DELETE SET NULL |
| `status`           | text        |   no | —         | domain-validated                                  |
| `checked_at`       | timestamptz |  yes | —         | —                                                 |
| `external_post_id` | text        |  yes | —         | —                                                 |
| `result`           | text        |  yes | —         | —                                                 |
| `details`          | jsonb       |  yes | —         | —                                                 |
| `created_at`       | timestamptz |   no | now       | —                                                 |

Reconciliation outcomes include:

```text
PUBLISHED
RETRY_ELIGIBLE
UNKNOWN
```

Indexes: `(publication_id)`, `(status)`.

There is no `updated_at`. Reconciliation records are append-oriented.

**Scope note:** the provider-aware natural key applies only to `external_interactions`. `publication_reconciliations` is scoped to the Meta publication pipeline and does not carry a `provider` column in DB v1.3.1.

---

### 5.28 `system_config`

Purpose: database-backed runtime configuration.

| Column       | Type        | Null | Default | Constraint                         |
| ------------ | ----------- | ---: | ------- | ---------------------------------- |
| `key`        | text        |   no | —       | PK                                 |
| `value`      | jsonb       |   no | —       | —                                  |
| `updated_by` | uuid        |  yes | —       | FK → `users.id` ON DELETE SET NULL |
| `updated_at` | timestamptz |   no | now     | —                                  |

The primary key is the configuration key itself (text), not a surrogate UUID. Examples include publication enablement, provider versions, and feature flags.

---

### 5.29 `config_audit_log`

Purpose: append-only history of configuration changes.

| Column       | Type        | Null | Default   | Constraint                         |
| ------------ | ----------- | ---: | --------- | ---------------------------------- |
| `id`         | uuid        |   no | generated | PK                                 |
| `key`        | text        |   no | —         | —                                  |
| `old_value`  | jsonb       |  yes | —         | —                                  |
| `new_value`  | jsonb       |  yes | —         | —                                  |
| `user_id`    | uuid        |  yes | —         | FK → `users.id` ON DELETE SET NULL |
| `reason`     | text        |  yes | —         | —                                  |
| `ip_address` | inet        |  yes | —         | —                                  |
| `created_at` | timestamptz |   no | now       | —                                  |

Records are append-only.

Index: `(key, created_at)`.

---

### 5.30 `ai_usage`

Purpose: durable accounting of AI processing usage.

| Column           | Type          | Null | Default   | Constraint                                 |
| ---------------- | ------------- | ---: | --------- | ------------------------------------------ |
| `id`             | uuid          |   no | generated | PK                                         |
| `content_id`     | uuid          |  yes | —         | FK → `content_items.id` ON DELETE SET NULL |
| `provider`       | text          |   no | —         | —                                          |
| `model`          | text          |   no | —         | —                                          |
| `operation`      | text          |   no | —         | —                                          |
| `input_tokens`   | integer       |   no | 0         | `>= 0`                                     |
| `output_tokens`  | integer       |   no | 0         | `>= 0`                                     |
| `estimated_cost` | numeric(12,6) |   no | 0         | `>= 0`                                     |
| `created_at`     | timestamptz   |   no | now       | —                                          |

The cost currency or unit remains an application-level decision (deferred decision D-006).

There is no `updated_at`.

Indexes: `(content_id)`, `(created_at)`.

---

### 5.31 `system_logs`

Purpose: optionally persisted structured operational and application logs.

| Column           | Type        | Null | Default   | Constraint                                 |
| ---------------- | ----------- | ---: | --------- | ------------------------------------------ |
| `id`             | uuid        |   no | generated | PK                                         |
| `level`          | text        |   no | —         | —                                          |
| `event`          | text        |   no | —         | —                                          |
| `message`        | text        |  yes | —         | —                                          |
| `trace_id`       | uuid        |  yes | —         | —                                          |
| `content_id`     | uuid        |  yes | —         | FK → `content_items.id` ON DELETE SET NULL |
| `story_id`       | uuid        |  yes | —         | FK → `stories.id` ON DELETE SET NULL       |
| `source_id`      | uuid        |  yes | —         | FK → `sources.id` ON DELETE SET NULL       |
| `job_id`         | text        |  yes | —         | external/transient job correlation only    |
| `publication_id` | uuid        |  yes | —         | FK → `publications.id` ON DELETE SET NULL  |
| `metadata`       | jsonb       |  yes | —         | —                                          |
| `created_at`     | timestamptz |   no | now       | —                                          |

Runtime logging does not require every log line to be persisted in PostgreSQL.

`job_id` is a correlation reference only. It does not make worker execution state authoritative in PostgreSQL.

Indexes: `(trace_id)`, `(created_at)`.

---

### 5.32 `notifications`

Purpose: durable operational notifications.

| Column           | Type        | Null | Default   | Constraint                                 |
| ---------------- | ----------- | ---: | --------- | ------------------------------------------ |
| `id`             | uuid        |   no | generated | PK                                         |
| `type`           | text        |   no | —         | domain-validated                           |
| `severity`       | text        |   no | —         | domain-validated                           |
| `title`          | text        |   no | —         | —                                          |
| `message`        | text        |   no | —         | —                                          |
| `source_id`      | uuid        |  yes | —         | FK → `sources.id` ON DELETE SET NULL       |
| `content_id`     | uuid        |  yes | —         | FK → `content_items.id` ON DELETE SET NULL |
| `publication_id` | uuid        |  yes | —         | FK → `publications.id` ON DELETE SET NULL  |
| `is_read`        | boolean     |   no | false     | —                                          |
| `created_at`     | timestamptz |   no | now       | —                                          |
| `read_at`        | timestamptz |  yes | —         | —                                          |

Notification types must cover at least:

```text
credential failure
system failure
queue backlog
publication failure
AI budget threshold
source failure
```

The `type` and `severity` vocabularies are domain-validated and remain text values in DB v1.

Indexes: `(is_read)`, `(created_at)`.

---

### 5.33 `audit_logs`

Purpose: append-only cross-domain audit trail for important application and administrative events that do not already have a dedicated structured history table.

| Column          | Type        | Null | Default   | Constraint                         |
| --------------- | ----------- | ---: | --------- | ---------------------------------- |
| `id`            | uuid        |   no | generated | PK                                 |
| `actor_user_id` | uuid        |  yes | —         | FK → `users.id` ON DELETE SET NULL |
| `action`        | text        |   no | —         | domain-validated                   |
| `entity_type`   | text        |   no | —         | domain-validated                   |
| `entity_id`     | uuid        |  yes | —         | polymorphic entity identifier      |
| `changes`       | jsonb       |  yes | —         | —                                  |
| `metadata`      | jsonb       |  yes | —         | —                                  |
| `created_at`    | timestamptz |   no | now       | —                                  |

`actor_user_id` is nullable for system-generated events.

`entity_id` is intentionally not a polymorphic foreign key because one PostgreSQL column cannot safely reference multiple entity tables. The pair `(entity_type, entity_id)` is application-validated.

The table is append-only at application level. Corrections are represented by new audit events rather than updates or deletes.

`audit_logs` supplements dedicated business-history structures such as `config_audit_log`, `moderation_actions`, `publication_attempts`, `publication_reconciliations`, `webhook_deliveries`, and `interaction_response_attempts`. It does not replace them.

Indexes: `(entity_type, entity_id, created_at)`, `(actor_user_id, created_at)`, `(action, created_at)`.

**Reserved action values** used by this contract:

```text
ROTATE_VERIFY_TOKEN             — verify token rotation (INVARIANT-17)
PRESERVATION_BASELINE_CAPTURED  — immutable pre-migration baseline (INVARIANT-22, §2.8.9)
PRESERVATION_EVIDENCE           — post-migration preservation digest and comparison (INVARIANT-19, §2.8.8)
MIGRATION_PHASE_COMPLETED       — one entry per completed migration phase
MIGRATION_RECOVERY_STARTED      — one entry when the partial-0016 recovery path begins (INVARIANT-21)
```

These values are contractual. They MUST NOT be renamed or repurposed.

**Immutability of `PRESERVATION_BASELINE_CAPTURED`.** Rows with `action = 'PRESERVATION_BASELINE_CAPTURED'` are strictly immutable after commit. No `UPDATE` or `DELETE` statement may target them, whether inside the migration runner, in an operator procedure, or in any other application path. This is enforced at the application layer, at code review, and by CI checks (see INVARIANT-22).

---

### 5.34 `webhook_endpoints`

Purpose: App-level webhook configuration aggregate that owns the verify token and its lifecycle.

**Scope boundary (INVARIANT-12, INVARIANT-13):**

- DB v1.3.1 supports exactly one Meta App per deployment.
- The `webhook_endpoints` table models N Pages under one App.
- `name` is **deployment-level App identity** sourced from deployment configuration (`META_APP_NAME`). It is NOT derived from any `webhook_subscriptions` row, destination row, or Page-specific data.
- After `0016 MIGRATE` completes, the deployment MUST contain exactly one `webhook_endpoints` row for the active Meta App.

This table is the inbound analogue of the App-level configuration root. It owns the verify token, whose lifecycle (verification, rotation) is independent of any individual Page subscription.

| Column                     | Type        | Null | Default   | Constraint                       |
| -------------------------- | ----------- | ---: | --------- | -------------------------------- |
| `id`                       | uuid        |   no | generated | PK                               |
| `provider`                 | varchar(32) |   no | —         | e.g. `META`                      |
| `name`                     | text        |   no | —         | deployment-level App identity    |
| `verify_token_encrypted`   | text        |   no | —         | `v1:base64(iv ‖ ct ‖ tag)`       |
| `verify_token_key_version` | integer     |   no | —         | `> 0`                            |
| `status`                   | varchar(32) |   no | —         | `ACTIVE`, `PAUSED`, `DISABLED`   |
| `last_verified_at`         | timestamptz |  yes | —         | App-level handshake timestamp    |
| `last_rotated_at`          | timestamptz |  yes | —         | authoritative rotation timestamp |
| `created_at`               | timestamptz |   no | now       | —                                |
| `updated_at`               | timestamptz |   no | now       | —                                |

**Constraints:**

```sql
UNIQUE (provider, name)
CHECK (status IN ('ACTIVE', 'PAUSED', 'DISABLED'))
CHECK (verify_token_key_version > 0)
```

**Index:** `(status)`.

**AAD binding (target-state authoritative):**

```
META:WEBHOOK_VERIFY_TOKEN:<endpoint_id>
```

This AAD is authoritative for all writes after `0017 SWITCH` and all reads after `0018 CONTRACT`. The legacy AAD `META:WEBHOOK_VERIFY_TOKEN:<destination_id>` is used only during the `0015`–`0018` migration window by the Compatibility Bridge and the `0016 MIGRATE` re-encryption step. See §4.6 for the full AAD naming convention.

**Key rotation:** the `verify_token_key_version` column selects the decryption key from `WEBHOOK_TOKEN_ENCRYPTION_KEYS`. The active write version is `WEBHOOK_TOKEN_ENCRYPTION_ACTIVE_VERSION`. New setups MUST use the versioned key model. Legacy single-key setups are migrated when the operator sets the versioned env vars.

**Token rotation dual-write (INVARIANT-17):** When rotating the endpoint verify token, the rotation transaction MUST also re-encrypt and update `verify_token_encrypted` and `verify_token_key_version` in every `webhook_subscriptions` row that references this endpoint, using each subscription's own `META:WEBHOOK_VERIFY_TOKEN:<destination_id>` AAD. All affected rows MUST be updated in the same transaction. Partial rotation is a contract violation. This requirement is in force during the Compatibility Bridge deployment, during `0017 SWITCH`, and for any post-`0018` operation that still encounters a legacy subscription representation (which, after `0018`, is none by construction, so the rule then reduces to the endpoint write alone).

**Bridge upsert conflict rule (INVARIANT-18):** When the Compatibility Bridge or any v1.3 write path resolves this row and the row already exists, the write path MUST decrypt the existing ciphertext with the endpoint AAD and compare plaintext to the plaintext of the incoming write. If the two plaintexts differ, the write path MUST abort the transaction and MUST NOT modify this row, any `webhook_subscriptions` row, or any other state in the same transaction. Silent overwrite is a contract violation. The compare-and-abort operation MUST be performed under the row lock obtained by `SELECT ... FOR UPDATE` (or an equivalent atomic upsert that fails on token mismatch).

**Handshake resolution (single-App scope):**

The Meta `GET /api/v1/webhooks/meta` handshake loads all ACTIVE endpoints for the requested provider and attempts to decrypt each endpoint's ciphertext with the incoming `hub.verify_token` as the comparison target. Because INVARIANT-12 guarantees one App per deployment, at most one endpoint exists, and the loop terminates in O(1). Multi-App support is deferred to a future revision (§24, D-013).

---

### 5.35 `webhook_subscriptions`

Purpose: technical subscription configuration for an inbound webhook from an external provider to a specific destination.

A `webhook_subscriptions` row represents a concrete Page-scoped subscription belonging to a `webhook_endpoints` row. It is the inbound analogue of `source_endpoints`: a destination may own multiple subscriptions, and each subscription carries its own lifecycle.

**Target state (after migration `0018 CONTRACT`):**

| Column             | Type        | Null | Default   | Constraint                                     |
| ------------------ | ----------- | ---: | --------- | ---------------------------------------------- |
| `id`               | uuid        |   no | generated | PK                                             |
| `destination_id`   | uuid        |   no | —         | FK → `destinations.id` ON DELETE CASCADE       |
| `endpoint_id`      | uuid        |   no | —         | FK → `webhook_endpoints.id` ON DELETE RESTRICT |
| `provider`         | varchar(32) |   no | —         | e.g. `META`                                    |
| `fields`           | text[]      |   no | —         | non-empty array                                |
| `status`           | varchar(32) |   no | —         | `ACTIVE`, `PAUSED`, `DISABLED`                 |
| `last_verified_at` | timestamptz |  yes | —         | destination-level handshake timestamp          |
| `created_at`       | timestamptz |   no | now       | —                                              |
| `updated_at`       | timestamptz |   no | now       | —                                              |

**Transitional state (during `0015`–`0017`):**

The legacy columns `verify_token_encrypted`, `verify_token_key_version`, and `last_rotated_at` remain present and nullable until dropped by `0018 CONTRACT`. The `endpoint_id` column is added nullable by `0015 EXPAND` and made NOT NULL by `0018 CONTRACT`. See §20 for the full migration protocol.

**Constraints (target state):**

```sql
UNIQUE (destination_id, provider)
CHECK (status IN ('ACTIVE', 'PAUSED', 'DISABLED'))
CHECK (cardinality(fields) > 0)
```

**Indexes:** `(status)`, `(endpoint_id)`.

**Invariants:**

- `fields` is a non-empty array; each element is validated against the domain vocabulary (`feed`, `mention`, and future values).
- `verify_token_encrypted` (transitional) is never decrypted outside the ingress handler.
- Verify token rotation is a manual administrative operation and must produce an `audit_logs` entry.
- **Rotation dual-write (INVARIANT-17).** When the referenced `webhook_endpoints` verify token is rotated, this subscription's `verify_token_encrypted` and `verify_token_key_version` MUST be updated in the same transaction using this subscription's own `META:WEBHOOK_VERIFY_TOKEN:<destination_id>` AAD. The write path MUST update all subscriptions referencing the rotated endpoint atomically.

**Lifecycle:** `ACTIVE`, `PAUSED`, `DISABLED`.

**Verification event ownership:**

- `webhook_subscriptions.last_verified_at` records a **destination-scoped verification event** (a successful `hub.challenge` handshake during subscription onboarding or re-verification).
- `webhook_endpoints.last_verified_at` records an **App-scoped verification event**.
- `webhook_subscription_health.last_success_at` records an **operational event** (a successfully processed inbound webhook delivery).

These timestamps are not interchangeable and must not be unified. See §9.6.

**Removed in the v1.3.1 target state (`0018 CONTRACT`):** `verify_token_encrypted`, `verify_token_key_version`, `last_rotated_at`.

**Added in the v1.3.1 target state (`0015 EXPAND`, `endpoint_id` NOT NULL in `0018`):** `endpoint_id`.

---

### 5.36 `webhook_subscription_health`

Purpose: operational health extension for a `webhook_subscriptions` row.

The table is a strict 1:1 extension of `webhook_subscriptions`. It mirrors the pattern established by `source_endpoint_health` (§5.5) and preserves operational health history that cannot be reconstructed later from `audit_logs` or `system_logs`.

| Column                  | Type        | Null | Default | Constraint                                            |
| ----------------------- | ----------- | ---: | ------- | ----------------------------------------------------- |
| `subscription_id`       | uuid        |   no | —       | PK, FK → `webhook_subscriptions.id` ON DELETE CASCADE |
| `consecutive_failures`  | integer     |   no | 0       | `>= 0`                                                |
| `consecutive_successes` | integer     |   no | 0       | `>= 0`                                                |
| `last_success_at`       | timestamptz |  yes | —       | —                                                     |
| `last_failure_at`       | timestamptz |  yes | —       | —                                                     |
| `last_error_category`   | varchar(64) |  yes | —       | canonical taxonomy from §5.38                         |
| `last_error_message`    | text        |  yes | —       | —                                                     |
| `events_today`          | integer     |   no | 0       | `>= 0`                                                |
| `updated_at`            | timestamptz |   no | now     | —                                                     |

**Invariants:**

- `consecutive_failures >= 0` and `consecutive_successes >= 0`.
- `events_today >= 0`.
- The health record is created automatically when its owning subscription is created. It is not optional.

**Relationship to `webhook_subscriptions`:**

The health record is deleted with its owning subscription when that subscription is intentionally deleted. The 1:1 cardinality is enforced by the primary key being a foreign key to `webhook_subscriptions.id`.

**Separation of concerns:**

- `webhook_subscriptions.last_verified_at` records a **configuration lifecycle event** (a successful `hub.challenge` handshake).
- `webhook_subscription_health.last_success_at` records an **operational event** (a successfully processed inbound webhook delivery).
- These timestamps are not interchangeable and must not be unified.

Health is intentionally separated from subscription configuration so that high-frequency operational updates do not require rewriting relatively stable configuration data. This mirrors the DB v1 core principle of separating operational health from configuration, as established for `source_endpoints` / `source_endpoint_health` (see §3.4 for the architectural rationale, §5.5 for the concrete table pattern).

**Scope:** storage now, use later. The table is part of DB v1.3.1. Health metrics consumption (alerting thresholds, auto-pause policy, dashboards, reputation-style decay) is a separate concern and remains deferred (D-009).

Index: `(last_failure_at)`.

---

### 5.37 `webhook_events`

Purpose: immutable receipt of a single inbound HTTP POST from an external webhook provider.

A `webhook_events` row corresponds to one HTTP transaction: one received body, one signature verification, one idempotency key. The envelope may contain multiple entries and multiple changes; those materialize into `external_interactions` during processing.

| Column               | Type         | Null | Default    | Constraint                                |
| -------------------- | ------------ | ---: | ---------- | ----------------------------------------- |
| `id`                 | uuid         |   no | generated  | PK                                        |
| `provider`           | varchar(32)  |   no | —          | `META`                                    |
| `destination_id`     | uuid         |  yes | —          | FK → `destinations.id` ON DELETE SET NULL |
| `object_type`        | varchar(32)  |   no | —          | e.g. `page`                               |
| `external_object_id` | text         |   no | —          | Page ID from payload                      |
| `field`              | varchar(64)  |  yes | —          | top-level field if extractable            |
| `idempotency_key`    | text         |   no | —          | UNIQUE                                    |
| `raw_payload`        | jsonb        |   no | —          | immutable                                 |
| `raw_body_hash`      | varchar(128) |   no | —          | SHA-256 of raw HTTP body                  |
| `signature_verified` | boolean      |   no | —          | always `true` under fail-closed ingress   |
| `trace_id`           | uuid         |   no | generated  | propagated downstream                     |
| `status`             | varchar(32)  |   no | `RECEIVED` | see §9.2                                  |
| `received_at`        | timestamptz  |   no | now        | —                                         |
| `processed_at`       | timestamptz  |  yes | —          | —                                         |
| `updated_at`         | timestamptz  |   no | now        | —                                         |

Unique constraint:

```text
(idempotency_key)
```

Status vocabulary:

```sql
CHECK (status IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD_LETTER'))
```

Invariants:

- `raw_payload` and `raw_body_hash` are immutable after insert.
- `idempotency_key = sha256(provider || raw_body_hash)`.
- `signature_verified` must be `true`; rows with `false` are not permitted under fail-closed ingress and are rejected at the HTTP boundary.
- `status = 'PROCESSED'` → `processed_at IS NOT NULL`.

Indexes: `(status, received_at)`, `(destination_id, received_at DESC)`, `(field, received_at DESC)`, `(trace_id)`.

Lifecycle: see §9.2.

---

### 5.38 `webhook_deliveries`

Purpose: durable history of processing attempts for a `webhook_events` row.

This table is the business-history table for webhook processing side effects. It is not a generic worker execution log and does not duplicate BullMQ retry metadata.

| Column             | Type        | Null | Default   | Constraint                                             |
| ------------------ | ----------- | ---: | --------- | ------------------------------------------------------ |
| `id`               | uuid        |   no | generated | PK                                                     |
| `webhook_event_id` | uuid        |   no | —         | FK → `webhook_events.id` ON DELETE CASCADE             |
| `attempt_number`   | integer     |   no | —         | `> 0`, UNIQUE with event                               |
| `status`           | varchar(32) |   no | —         | `PENDING`, `SUCCESS`, `RETRY`, `FAILED`, `DEAD_LETTER` |
| `started_at`       | timestamptz |  yes | —         | —                                                      |
| `finished_at`      | timestamptz |  yes | —         | —                                                      |
| `error_category`   | varchar(64) |  yes | —         | canonical taxonomy                                     |
| `error_message`    | text        |  yes | —         | —                                                      |
| `worker_id`        | text        |  yes | —         | diagnostic                                             |
| `created_at`       | timestamptz |   no | now       | —                                                      |

Unique constraint:

```text
(webhook_event_id, attempt_number)
```

Canonical `error_category` vocabulary:

```text
PAYLOAD_MALFORMED
UNSUPPORTED_FIELD
UNKNOWN_DESTINATION
UNKNOWN_PUBLICATION
PROCESSING_ERROR
EXTERNAL_API_ERROR
RATE_LIMIT
NETWORK_ERROR
UNKNOWN
```

`SIGNATURE_INVALID` is not a valid value here because signature verification fails closed at the HTTP ingress boundary and never produces a `webhook_events` row.

Index: `(status)`.

---

### 5.39 `external_interactions`

Purpose: materialized inbound interaction derived from a `webhook_events` row.

This is the inbound domain's independent business entity. It carries its own identity and references content lifecycle entities only loosely and optionally.

| Column                    | Type        | Null | Default   | Constraint                                  |
| ------------------------- | ----------- | ---: | --------- | ------------------------------------------- |
| `id`                      | uuid        |   no | generated | PK                                          |
| `webhook_event_id`        | uuid        |  yes | —         | FK → `webhook_events.id` ON DELETE SET NULL |
| `destination_id`          | uuid        |  yes | —         | FK → `destinations.id` ON DELETE SET NULL   |
| `publication_id`          | uuid        |  yes | —         | FK → `publications.id` ON DELETE SET NULL   |
| `provider`                | varchar(32) |   no | —         | `META`                                      |
| `interaction_type`        | varchar(32) |   no | —         | `COMMENT`, `REACTION`, `MENTION`            |
| `external_interaction_id` | text        |   no | —         | provider-side identifier                    |
| `parent_external_id`      | text        |  yes | —         | reply target, if any                        |
| `actor_external_id`       | text        |  yes | —         | provider user identifier                    |
| `actor_display_name`      | text        |  yes | —         | —                                           |
| `content`                 | text        |  yes | —         | comment text, if any                        |
| `permalink`               | text        |  yes | —         | —                                           |
| `occurred_at`             | timestamptz |   no | —         | provider event time                         |
| `raw_metadata`            | jsonb       |   no | `{}`      | —                                           |
| `created_at`              | timestamptz |   no | now       | —                                           |
| `updated_at`              | timestamptz |   no | now       | —                                           |

**Natural key (D-016):**

```text
UNIQUE INDEX (provider, external_interaction_id)
```

enforced by the unique index `external_interactions_provider_external_id_uq` (INVARIANT-11). This is a **UNIQUE INDEX**, not a PostgreSQL `UNIQUE CONSTRAINT`.

The `interaction_type` column is descriptive metadata; it is not part of the natural key.

**Supporting indexes:**

```text
external_interactions(publication_id, occurred_at DESC)
external_interactions(destination_id, occurred_at DESC)
external_interactions(interaction_type, occurred_at DESC)
```

**Invariants:**

- The `(provider, external_interaction_id)` pair is the natural external identity.
- **`occurred_at` monotonicity (precise definition, D-018).** For a given `(provider, external_interaction_id)`, the `occurred_at` value stored in the row MUST NOT decrease across accepted mutations. An accepted mutation is any `INSERT ... ON CONFLICT` or `UPDATE` that commits successfully. The enforcement mechanism is the upsert predicate:
  ```sql
  WHERE external_interactions.occurred_at <= EXCLUDED.occurred_at
  ```
  An incoming row whose `occurred_at` is strictly earlier than the currently persisted value for the same `(provider, external_interaction_id)` MUST NOT be applied; the persisted row MUST remain unchanged. Concurrent inserts serialize on the unique index via PostgreSQL's `ON CONFLICT` mechanism. See D-018.
- Soft deletion (`verb = "remove"`) is represented in `raw_metadata` and does not physically delete the row.

**Foreign key behavior:**

- `webhook_event_id`, `destination_id`, and `publication_id` are all `ON DELETE SET NULL`. The interaction outlives its originating event, destination, or publication.

The `publication_id` FK to `publications.id` is added by the deferred migration step `0009` in the current migration set because the `publications` table is created after `external_interactions` in the dependency order. See §19.

---

### 5.40 `provider_credentials`

Purpose: encrypted storage of provider authentication material with lifecycle tracking.

| Column                   | Type        | Null | Default   | Constraint                                |
| ------------------------ | ----------- | ---: | --------- | ----------------------------------------- |
| `id`                     | uuid        |   no | generated | PK                                        |
| `scope`                  | varchar(32) |   no | —         | `APP`, `DESTINATION`                      |
| `destination_id`         | uuid        |  yes | —         | FK → `destinations.id` ON DELETE CASCADE  |
| `provider`               | varchar(32) |   no | —         | e.g. `META`                               |
| `credential_type`        | varchar(64) |   no | —         | `APP_SECRET`, `PAGE_ACCESS_TOKEN`         |
| `encrypted_value`        | text        |   no | —         | `v1:base64(iv ‖ ct ‖ tag)`                |
| `encryption_key_version` | integer     |   no | —         | `> 0`                                     |
| `status`                 | varchar(32) |   no | `UNKNOWN` | `VALID`, `EXPIRING`, `INVALID`, `UNKNOWN` |
| `expires_at`             | timestamptz |  yes | —         | —                                         |
| `last_validated_at`      | timestamptz |  yes | —         | —                                         |
| `last_rotation_at`       | timestamptz |  yes | —         | —                                         |
| `rotation_reason`        | text        |  yes | —         | —                                         |
| `created_at`             | timestamptz |   no | now       | —                                         |
| `updated_at`             | timestamptz |   no | now       | —                                         |

**Uniqueness:**

Two partial unique indexes enforce the APP and DESTINATION uniqueness rules without a sentinel UUID:

```sql
CREATE UNIQUE INDEX provider_credentials_app_uq
  ON provider_credentials (provider, credential_type)
  WHERE scope = 'APP' AND destination_id IS NULL;

CREATE UNIQUE INDEX provider_credentials_destination_uq
  ON provider_credentials (provider, credential_type, destination_id)
  WHERE scope = 'DESTINATION' AND destination_id IS NOT NULL;
```

The partial-index form expresses the domain rule directly and avoids the collision risk of a sentinel UUID.

**Check constraints:**

```sql
CHECK (scope IN ('APP', 'DESTINATION'))
CHECK (status IN ('VALID', 'EXPIRING', 'INVALID', 'UNKNOWN'))
CHECK (encryption_key_version > 0)
CHECK (
  (scope = 'APP' AND destination_id IS NULL) OR
  (scope = 'DESTINATION' AND destination_id IS NOT NULL)
)
```

**Indexes:** `(status)`, `(expires_at)`.

**Invariants:**

- `scope = 'APP'` → `destination_id IS NULL`.
- `scope = 'DESTINATION'` → `destination_id IS NOT NULL`.
- `expires_at IS NULL` is permitted for credentials that do not expire (e.g. App Secret).
- The plaintext value is never logged, audited, cached beyond its in-memory operation lifetime, or persisted outside this table.

**Encryption:**

- Algorithm: AES-256-GCM.
- Key material supplied via environment variables (`META_CREDENTIAL_ENCRYPTION_KEYS`, `META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION`).
- Additional authenticated data (AAD) binds the ciphertext to `provider:credential_type:<destination_id | 'app'>`.
- Key version is stored per row so that rotation does not require a full-table rewrite in a single transaction.

---

### 5.41 `interaction_responses`

Purpose: durable intent to publish an outbound response to an `external_interactions` row.

| Column                 | Type        | Null | Default   | Constraint                                        |
| ---------------------- | ----------- | ---: | --------- | ------------------------------------------------- |
| `id`                   | uuid        |   no | generated | PK                                                |
| `interaction_id`       | uuid        |   no | —         | FK → `external_interactions.id` ON DELETE CASCADE |
| `destination_id`       | uuid        |   no | —         | FK → `destinations.id` ON DELETE RESTRICT         |
| `template_id`          | text        |  yes | —         | reference into `system_config`                    |
| `template_version`     | integer     |   no | 1         | `>= 1`                                            |
| `body`                 | text        |  yes | —         | final response text (may be set post-moderation)  |
| `status`               | varchar(32) |   no | `DRAFT`   | see §9.3                                          |
| `scheduled_at`         | timestamptz |  yes | —         | —                                                 |
| `responded_at`         | timestamptz |  yes | —         | —                                                 |
| `external_response_id` | text        |  yes | —         | provider-side identifier                          |
| `created_at`           | timestamptz |   no | now       | —                                                 |
| `updated_at`           | timestamptz |   no | now       | —                                                 |

Unique constraint:

```text
(interaction_id)
```

**Status vocabulary (complete, aligned with §9.3):**

```sql
CHECK (status IN (
  'DRAFT',
  'AUTO_RESPOND',
  'MODERATION_REQUIRED',
  'APPROVED',
  'REJECTED',
  'SCHEDULED',
  'RESPONDED',
  'FAILED',
  'CANCELLED'
))
```

**Referential action rationale:**

`destination_id` is `NOT NULL` because an interaction response is a business artifact scoped to a concrete destination. The referential action is `ON DELETE RESTRICT` because the response cannot exist without a destination, and setting the column to NULL would violate its `NOT NULL` declaration. See §4.5.

**Invariants:**

- One response per interaction in DB v1. Multi-response threads are a deferred decision (D-008).
- `status = 'RESPONDED'` → `external_response_id IS NOT NULL AND responded_at IS NOT NULL`.
- `status = 'SCHEDULED'` → `scheduled_at IS NOT NULL`.
- Terminal statuses: `RESPONDED`, `REJECTED`, `FAILED`, `CANCELLED`.

Indexes: `(status, scheduled_at)`, `(destination_id, status)`, `(external_response_id)`.

---

### 5.42 `interaction_response_attempts`

Purpose: durable history of outbound response execution.

| Column                 | Type         | Null | Default   | Constraint                                                        |
| ---------------------- | ------------ | ---: | --------- | ----------------------------------------------------------------- |
| `id`                   | uuid         |   no | generated | PK                                                                |
| `response_id`          | uuid         |   no | —         | FK → `interaction_responses.id` ON DELETE CASCADE                 |
| `attempt_number`       | integer      |   no | —         | `> 0`, UNIQUE with response                                       |
| `status`               | varchar(32)  |   no | —         | `PENDING`, `SUCCESS`, `RETRY`, `FAILED`, `DEAD_LETTER`, `UNKNOWN` |
| `started_at`           | timestamptz  |  yes | —         | —                                                                 |
| `finished_at`          | timestamptz  |  yes | —         | —                                                                 |
| `error_category`       | varchar(64)  |  yes | —         | canonical taxonomy                                                |
| `error_message`        | text         |  yes | —         | —                                                                 |
| `external_response_id` | text         |  yes | —         | —                                                                 |
| `request_payload_hash` | varchar(128) |   no | —         | SHA-256 of outbound body                                          |
| `created_at`           | timestamptz  |   no | now       | —                                                                 |

Unique constraint:

```text
(response_id, attempt_number)
```

`request_payload_hash` enables deterministic reconciliation: two attempts with the same hash were the same logical request.

Index: `(status)`.

---

### 5.43 `interaction_moderation_actions`

Purpose: durable moderation decision history for `interaction_responses`.

| Column          | Type        | Null | Default   | Constraint                                        |
| --------------- | ----------- | ---: | --------- | ------------------------------------------------- |
| `id`            | uuid        |   no | generated | PK                                                |
| `response_id`   | uuid        |   no | —         | FK → `interaction_responses.id` ON DELETE CASCADE |
| `user_id`       | uuid        |   no | —         | FK → `users.id` ON DELETE RESTRICT                |
| `action`        | varchar(32) |   no | —         | `APPROVE`, `REJECT`, `EDIT`, `ESCALATE`           |
| `reason`        | text        |  yes | —         | —                                                 |
| `previous_body` | text        |  yes | —         | required when `action = 'EDIT'`                   |
| `created_at`    | timestamptz |   no | now       | —                                                 |

This table is deliberately separate from `moderation_actions` because that table is scoped to `publication_candidates` (content lifecycle), whereas this table is scoped to inbound interactions.

`previous_body` is required by the application layer when `action = 'EDIT'`. DB v1 does not enforce this with a `CHECK` constraint; the validation is performed by the moderation service.

Indexes: `(response_id, created_at DESC)`, `(user_id, created_at DESC)`.

---

### 5.44 `interaction_response_reconciliations`

Purpose: durable investigation of uncertain outbound response outcomes.

| Column                 | Type        | Null | Default   | Constraint                                                 |
| ---------------------- | ----------- | ---: | --------- | ---------------------------------------------------------- |
| `id`                   | uuid        |   no | generated | PK                                                         |
| `response_id`          | uuid        |   no | —         | FK → `interaction_responses.id` ON DELETE CASCADE          |
| `attempt_id`           | uuid        |  yes | —         | FK → `interaction_response_attempts.id` ON DELETE SET NULL |
| `status`               | varchar(32) |   no | —         | `RESPONDED`, `RETRY_ELIGIBLE`, `UNKNOWN`                   |
| `checked_at`           | timestamptz |  yes | —         | —                                                          |
| `external_response_id` | text        |  yes | —         | —                                                          |
| `details`              | jsonb       |  yes | —         | —                                                          |
| `created_at`           | timestamptz |   no | now       | —                                                          |

Reconciliation may proceed via two paths:

- **Push** — the platform's own response reappears as a `feed` webhook event and is matched to the response by `(destination_id, external_response_id)`.
- **Pull** — a scheduled worker queries the provider for the response state.

Push is preferred because it is a natural consequence of the two-way integration. Pull is a bounded fallback.

Indexes: `(response_id)`, `(status)`.

---

### 5.45 `outbox_jobs`

Purpose: unified transactional outbox for every durable domain transition that must produce an asynchronous side effect.

This table is a **platform primitive**. It is used by the webhook ingress, publication scheduling, credential refresh, and any future subsystem that must enqueue work inside a PostgreSQL transaction.

| Column            | Type        | Null | Default   | Constraint                                       |
| ----------------- | ----------- | ---: | --------- | ------------------------------------------------ |
| `id`              | uuid        |   no | generated | PK                                               |
| `queue_name`      | varchar(64) |   no | —         | BullMQ queue name                                |
| `job_id`          | text        |   no | —         | UNIQUE — BullMQ deduplication key                |
| `payload`         | jsonb       |   no | —         | identifiers only (§21)                           |
| `status`          | varchar(32) |   no | `PENDING` | `PENDING`, `DISPATCHING`, `DISPATCHED`, `FAILED` |
| `attempts`        | integer     |   no | 0         | `>= 0`                                           |
| `last_attempt_at` | timestamptz |  yes | —         | —                                                |
| `last_error`      | text        |  yes | —         | —                                                |
| `dispatched_at`   | timestamptz |  yes | —         | —                                                |
| `trace_id`        | uuid        |  yes | —         | nullable correlation                             |
| `created_at`      | timestamptz |   no | now       | —                                                |

Unique constraint:

```text
(job_id)
```

Check constraints:

```sql
CHECK (status IN ('PENDING','DISPATCHING','DISPATCHED','FAILED'))
CHECK (attempts >= 0)
CHECK (
  (status = 'DISPATCHED' AND dispatched_at IS NOT NULL) OR
  (status <> 'DISPATCHED' AND dispatched_at IS NULL)
)
```

Invariants:

- `payload` contains identifiers only. It must never contain a full document, a raw payload, or a secret.
- `job_id` is deterministic and idempotent. Enqueuing the same logical event twice produces the same `job_id`.
- There is no foreign key from `outbox_jobs` to any domain entity. The `job_id` string is the sole correlation mechanism. This is deliberate: the outbox is generic and must not couple to any domain table's lifecycle.

Lifecycle: see §9.4.

---

## 6. Referential Integrity

The canonical ingestion relationship graph:

```text
sources
  └── source_endpoints
        ├── source_endpoint_health
        └── discovery_observations
              └── discovered_resources
                    └── raw_resources
                          └── source_items
                                └── content_items
                                      ├── content_versions
                                      ├── content_urls
                                      ├── content_entities
                                      ├── content_categories
                                      ├── content_fingerprints
                                      ├── duplicate_matches
                                      └── story_members
                                            └── stories
```

### 6.1 Inbound and provider persistence graph

```text
destinations
  ├── webhook_subscriptions
  │     └── webhook_subscription_health
  ├── webhook_events
  ├── provider_credentials
  ├── external_interactions
  └── interaction_responses

webhook_endpoints
  └── webhook_subscriptions (via endpoint_id, ON DELETE RESTRICT)

webhook_events
  ├── webhook_deliveries
  └── external_interactions (nullable, SET NULL)

external_interactions
  └── interaction_responses

interaction_responses
  ├── interaction_response_attempts
  ├── interaction_moderation_actions
  └── interaction_response_reconciliations

publications
  └── external_interactions (nullable, SET NULL)

users
  └── interaction_moderation_actions

outbox_jobs
  (no foreign keys — deliberate)
```

### 6.2 Source derivation rule

`discovery_observations` stores only `endpoint_id`; the Source is derived through `source_endpoints.source_id`.

### 6.3 Provenance references

`provenance_events.endpoint_id` uses `ON DELETE SET NULL`.

### 6.4 Outbox isolation

`outbox_jobs` intentionally holds no foreign keys. This prevents the outbox from participating in cascade deletion and prevents the outbox lifecycle from being coupled to any domain entity's lifecycle. Cleanup is time-based (§7.5), not reference-based.

---

## 7. Delete Behavior

DB v1 follows ownership-oriented deletion for operational and intermediate artifacts and durability-oriented retention for business history.

Every `ON DELETE SET NULL` action in this section MUST be applied only to a nullable referencing column. A `NOT NULL` referencing column MUST use `ON DELETE RESTRICT` or `ON DELETE CASCADE`. See §4.5.

### 7.1 Cascade-appropriate relationships

```text
sources → source_endpoints
source_endpoints → source_endpoint_health
discovered_resources → discovery_observations
discovered_resources → raw_resources
content_items → content_urls
content_items → content_versions
content_items → content_entities
content_items → content_categories
content_items → content_fingerprints
content_items → duplicate_matches
content_items → story_members
stories → story_members
images → image_rights
destinations → webhook_subscriptions
destinations → provider_credentials
webhook_subscriptions → webhook_subscription_health
webhook_events → webhook_deliveries
external_interactions → interaction_responses
interaction_responses → interaction_response_attempts
interaction_responses → interaction_moderation_actions
interaction_responses → interaction_response_reconciliations
```

### 7.2 Set-null-appropriate relationships

All referencing columns below are nullable:

```text
destinations → webhook_events        (destination_id nullable)
destinations → external_interactions (destination_id nullable)
publications → external_interactions (publication_id nullable)
webhook_events → external_interactions (webhook_event_id nullable)
interaction_response_attempts → interaction_response_reconciliations (attempt_id nullable)
```

These preserve the external fact even when the referencing platform entity is intentionally removed.

### 7.3 Restrict-appropriate relationships

```text
publication_candidates → publications
destinations → publications
destinations → interaction_responses    (destination_id NOT NULL)
users → moderation_actions
users → interaction_moderation_actions
webhook_endpoints → webhook_subscriptions
```

`RESTRICT` prevents accidental deletion of a business-history-referenced entity. The publication history, moderation history, credential audit trail, and interaction response history are not silently removed.

**Rationale for `destinations → interaction_responses`:**

`interaction_responses.destination_id` is `NOT NULL`. Applying `ON DELETE SET NULL` to a `NOT NULL` column is impossible in PostgreSQL and would cause every parent deletion to fail with a constraint violation. `RESTRICT` is the correct semantics: a response cannot exist without a destination, and the destination cannot be deleted while a response references it. This preserves the business-history integrity of the outbound response lifecycle.

**Rationale for `webhook_endpoints → webhook_subscriptions`:**

A subscription cannot exist without an endpoint. An endpoint can only be deleted once all subscriptions referencing it are intentionally removed.

### 7.4 Durable-history relationships

`publication_attempts`, `publication_reconciliations`, `config_audit_log`, `audit_logs`, `webhook_deliveries`, `interaction_response_attempts`, and `interaction_response_reconciliations` are retained as durable history.

### 7.5 Outbox cleanup

`outbox_jobs` uses time-based cleanup, not cascade:

```sql
DELETE FROM outbox_jobs
WHERE status = 'DISPATCHED'
  AND dispatched_at < now() - interval '7 days';
```

`PENDING`, `DISPATCHING`, and `FAILED` rows are never deleted by the cleanup job. `FAILED` rows require manual resolution or an operator-initiated purge.

---

## 8. Required Indexes and Uniqueness

### 8.1 Core and supporting indexes

All core-model and supporting-platform indexes declared in §5 remain required exactly as specified.

### 8.2 Webhook persistence indexes

```text
webhook_endpoints(provider, name) UNIQUE
webhook_endpoints(status)

webhook_subscriptions(destination_id, provider) UNIQUE
webhook_subscriptions(status)
webhook_subscriptions(endpoint_id)

webhook_subscription_health(last_failure_at)

webhook_events(idempotency_key) UNIQUE
webhook_events(status, received_at)
webhook_events(destination_id, received_at DESC)
webhook_events(field, received_at DESC)
webhook_events(trace_id)

webhook_deliveries(webhook_event_id, attempt_number) UNIQUE
webhook_deliveries(status)

external_interactions_provider_external_id_uq
  UNIQUE INDEX (provider, external_interaction_id)
external_interactions(publication_id, occurred_at DESC)
external_interactions(destination_id, occurred_at DESC)
external_interactions(interaction_type, occurred_at DESC)
```

`external_interactions_provider_external_id_uq` is a **UNIQUE INDEX**, not a PostgreSQL `UNIQUE CONSTRAINT` (INVARIANT-11). No non-unique transitional index on the same column set is permitted (INVARIANT-15).

### 8.3 Credential indexes

```text
provider_credentials_app_uq
  UNIQUE INDEX (provider, credential_type)
  WHERE scope = 'APP' AND destination_id IS NULL

provider_credentials_destination_uq
  UNIQUE INDEX (provider, credential_type, destination_id)
  WHERE scope = 'DESTINATION' AND destination_id IS NOT NULL

provider_credentials(status)
provider_credentials(expires_at)
```

### 8.4 Interaction response indexes

```text
interaction_responses(interaction_id) UNIQUE
interaction_responses(status, scheduled_at)
interaction_responses(destination_id, status)
interaction_responses(external_response_id)

interaction_response_attempts(response_id, attempt_number) UNIQUE
interaction_response_attempts(status)

interaction_moderation_actions(response_id, created_at DESC)
interaction_moderation_actions(user_id, created_at DESC)

interaction_response_reconciliations(response_id)
interaction_response_reconciliations(status)
```

### 8.5 Outbox indexes

```text
outbox_jobs(job_id) UNIQUE

outbox_jobs(status, created_at)
WHERE status IN ('PENDING', 'DISPATCHING')
```

The partial index deliberately covers both `PENDING` and `DISPATCHING` rows because the dispatcher scans both. `DISPATCHED` rows are excluded to keep the index small over time.

### 8.6 Hot-path publication lookup index

```text
publications(external_post_id) WHERE external_post_id IS NOT NULL
```

The webhook processing pipeline resolves inbound interactions to their originating publication through `publications.external_post_id`:

```sql
SELECT id FROM publications WHERE external_post_id = $1;
```

This lookup executes on the `webhook.process` hot path for every inbound comment, reaction, and mention. The partial index is required because:

- `external_post_id` is `NULL` until the external publication is confirmed; indexing `NULL` rows is wasteful.
- The lookup pattern is always `WHERE external_post_id = X AND X IS NOT NULL`.
- Without this index, the lookup degrades to a full table scan as the publications history grows.

No unique constraint is placed on `external_post_id`. The column represents a historical external identifier that may legitimately repeat if an external post is deleted and re-created by the provider.

### 8.7 Index discipline

Additional indexes must not be added mechanically. Every index must correspond to a documented query pattern or operational need. Redundant transitional indexes (INVARIANT-15) are prohibited.

---

## 9. Lifecycle Integrity

The database stores durable state. The domain/application layer owns legal lifecycle transitions.

### 9.1 Source, endpoint, content, and publication lifecycles

- **Source:** `ACTIVE`, `PAUSED`, `DISABLED`.
- **Endpoint:** `ACTIVE`, `PAUSED`, `DISABLED`.
- **Content:** `DRAFT`, `PUBLISHED`, `ARCHIVED`, `TRASHED`.
- **Publication:** `SCHEDULED`, `RESERVED`, `IN_PROGRESS`, `PUBLISHED`, `RETRY`, `FAILED`, `RECONCILIATION`.

### 9.2 Webhook event lifecycle

Inbound webhook events transition through the following state machine:

```text
RECEIVED → PROCESSING → PROCESSED
                 │
                 └──> FAILED
                        │
                        ├──> PROCESSING    (retry via BullMQ)
                        │
                        └──> DEAD_LETTER   (exhausted)
```

- **`RECEIVED`**: The HTTP POST request has passed signature verification, and the raw payload has been durably committed to `webhook_events` alongside an enqueued outbox job.
- **`PROCESSING`**: A worker has claimed the event and is dispatching the payload to domain handlers.
- **`PROCESSED`**: Domain materialization completed successfully. Terminal.
- **`FAILED`**: The most recent processing attempt failed. **Recoverable**: BullMQ retry or `system.rebuild` may restore `PROCESSING`.
- **`DEAD_LETTER`**: Retry attempts exhausted or an unrecoverable failure occurred. **Terminal.** Requires explicit operator action.

Re-processing an already `PROCESSED` event is structurally prevented by the immutable `idempotency_key` uniqueness constraint.

A `PROCESSING` row whose `updated_at` is older than `WEBHOOK_PROCESSING_TIMEOUT_SECONDS` is recoverable by `system.rebuild`. The recovery path returns the row to `RECEIVED` and re-enqueues the outbox job.

**Recovery query:**

```sql
SELECT id FROM webhook_events
WHERE status IN ('RECEIVED', 'FAILED')
   OR (status = 'PROCESSING' AND updated_at < now() - interval '5 minutes');
```

`DEAD_LETTER` is excluded from automatic recovery.

### 9.3 Interaction response lifecycle

Outbound responses to external interactions follow an explicit review and publishing workflow:

```text
DRAFT ──> MODERATION_REQUIRED ──> APPROVED ──> SCHEDULED ──> RESPONDED
  │               │                   │
  │               └──> REJECTED       └──> FAILED
  │
  └──> AUTO_RESPOND ──────────────────────────> RESPONDED
```

Additional transitions:

- Any non-terminal state → `CANCELLED` (operator or policy-initiated cancellation).

- **`DRAFT`**: The initial state when a response record is created.
- **`AUTO_RESPOND`**: Automated classification determined the response is safe for immediate dispatch without human review.
- **`MODERATION_REQUIRED`**: Sentiment, keyword filters, or policy rules flagged the response, holding it for human review in `interaction_moderation_actions`.
- **`APPROVED` / `REJECTED`**: Moderator decision outcomes. Approved responses move to scheduling or immediate dispatch.
- **`SCHEDULED`**: The response is waiting for its designated `scheduled_at` timestamp.
- **`RESPONDED`**: The external provider successfully accepted the outbound response, and `external_response_id` is populated.
- **`FAILED`**: Delivery attempts exhausted without success.
- **`CANCELLED`**: Operator or policy-initiated cancellation.

Terminal statuses: `RESPONDED`, `REJECTED`, `FAILED`, `CANCELLED`.

The complete status vocabulary is enforced by the `CHECK` constraint on `interaction_responses.status` (§5.41).

Editing an approved response (`EDIT` action in `interaction_moderation_actions`) returns the response to `MODERATION_REQUIRED` and requires re-validation before dispatch.

### 9.4 Outbox lifecycle

`outbox_jobs` manages the transactional transfer of work from PostgreSQL to the asynchronous BullMQ execution layer:

```text
PENDING ──> DISPATCHING ──> DISPATCHED
    │
    └──> FAILED
```

- **`PENDING`**: Committed within a business transaction, waiting to be picked up by the outbox dispatcher poller.
- **`DISPATCHING`**: Claimed by the active dispatcher thread to be published into the designated Redis/BullMQ queue.
- **`DISPATCHED`**: Successfully enqueued into BullMQ. The job ID is handed off, and the side effect is now managed by the worker runtime.
- **`FAILED`**: Dispatch failed due to infrastructure errors or broker unavailability, requiring operator intervention or automated sweep retry.

A `DISPATCHING` row whose `last_attempt_at` is older than `OUTBOX_DISPATCH_STALE_THRESHOLD_SECONDS` is recoverable. Recovery sets it back to `PENDING` and allows re-dispatch.

Terminal statuses: `DISPATCHED`, `FAILED`.

### 9.5 Reconciliation invariants

Every state machine in v1.3.1 that has an external side effect must have a reconciliation path:

- `webhook_events` uses stale-`PROCESSING` recovery, not a reconciliation table, because processing is a local operation.
- `interaction_responses` uses `interaction_response_reconciliations` with both push and pull paths.
- `outbox_jobs` uses stale-`DISPATCHING` recovery, not a reconciliation table, because dispatch is an internal operation.

### 9.6 Verification event ownership

Three timestamps record distinct concepts and MUST NOT be unified:

- `webhook_subscriptions.last_verified_at` — destination-scoped handshake success.
- `webhook_endpoints.last_verified_at` — App-scoped handshake success.
- `webhook_subscription_health.last_success_at` — operational inbound delivery success.

The GET handshake updates the subscription's `last_verified_at` and the endpoint's `last_verified_at` in the same transaction when both are resolved.

---

## 10. Endpoint State Atomicity and Concurrency

The old source-level cursor model is removed from DB v1.

Endpoint-specific incremental state is persisted in:

```text
source_endpoints.state
source_endpoints.state_version
```

A worker must preserve the state version it observed when it started processing an endpoint.

A state update succeeds only when:

```text
persisted.state_version == observed.state_version
```

The successful update must atomically:

1. write the new endpoint state;
2. increment `state_version`;
3. update `updated_at`.

If the optimistic-lock condition fails, the worker must not overwrite a newer endpoint state.

Pipeline persistence that depends on accepted discovery results should be performed in a PostgreSQL transaction so that durable artifact persistence and endpoint state advancement remain consistent.

---

## 11. Daily Source/Endpoint Limits

The source `safety_limits` configuration may contain limits such as:

```text
maxItemsPerDay
maxItemsPerPoll
requestTimeoutMs
maxResponseSizeBytes
maxRequestsPerMinute
```

DB v1 requires concurrency-safe durable enforcement of `maxItemsPerDay`.

The operational counter is stored in:

```text
source_endpoint_health.items_today
```

because the ingestion architecture applies execution and discovery limits at the technical endpoint boundary.

The application/transaction layer is responsible for atomic counter updates and for defining the reset semantics for a new calendar day.

---

## 12. Transactional Outbox Boundary

### 12.1 Principle

Every durable domain transition that must produce an asynchronous side effect enqueues its job through `outbox_jobs` inside the same PostgreSQL transaction that commits the domain state.

```text
BEGIN
  <domain state mutation>
  INSERT INTO outbox_jobs (queue_name, job_id, payload, trace_id)
COMMIT
```

A separate in-process component, the `OutboxDispatcher`, reads `PENDING` rows and dispatches them to BullMQ.

### 12.2 Rationale

PostgreSQL and Redis are independent systems. No transactional client spans both. Attempting to enqueue directly inside the PostgreSQL transaction produces an unrecoverable split-brain:

```text
COMMIT succeeds, Redis add fails  → orphaned event in DB, never processed
COMMIT fails, Redis add succeeds  → orphaned job in queue, worker crashes on load
```

The outbox pattern removes this class of failure by making the enqueue intent durable in the same system that owns the domain state. Redis becomes a derived cache, not a coordination point.

### 12.3 Ingress transaction boundary

The Meta webhook ingress enforces exactly one transaction boundary:

```text
1. Verify signature (fail-closed → 401)
2. Validate envelope with Zod (fail-closed → 400)
3. Resolve destination (read-only, outside the transaction)
4. BEGIN
     INSERT INTO webhook_events (...)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id
     IF inserted:
       INSERT INTO outbox_jobs (
         queue_name = 'webhook.process',
         job_id     = 'webhook.process:' || event.id,
         payload    = jsonb_build_object('webhookEventId', event.id),
         trace_id   = event.trace_id
       )
   COMMIT
5. HTTP 200 OK
```

No Redis call occurs on the HTTP hot path. Redis unavailability cannot block ingress, cannot produce orphaned events, and cannot produce orphaned jobs.

Destination resolution is outside the transaction, but the resolved ID participates in the transactional write. If the destination cannot be resolved, `destination_id` is written as `NULL` (a legitimate provider case), and downstream processing fails closed where destination context is required.

### 12.4 Dispatcher claim semantics

The dispatcher claims work using `FOR UPDATE SKIP LOCKED`:

```sql
WITH claimed AS (
  SELECT id
  FROM outbox_jobs
  WHERE status = 'PENDING'
  ORDER BY created_at
  LIMIT $1
  FOR UPDATE SKIP LOCKED
)
UPDATE outbox_jobs
SET status = 'DISPATCHING',
    last_attempt_at = now(),
    attempts = attempts + 1
WHERE id IN (SELECT id FROM claimed)
RETURNING *;
```

This allows multiple dispatcher instances to operate concurrently without coordination. `SKIP LOCKED` guarantees no two dispatchers claim the same row.

### 12.5 Dispatch and recovery

After claiming, the dispatcher calls BullMQ and then marks the row `DISPATCHED`. If the dispatcher crashes between the BullMQ add and the `DISPATCHED` update, the row remains `DISPATCHING`. Recovery restores it to `PENDING` after `OUTBOX_DISPATCH_STALE_THRESHOLD_SECONDS`.

BullMQ's `jobId` option **reduces** duplicate queue insertion during recovery: a recovered row produces the same `job_id`, which BullMQ uses for deduplication while the previously enqueued job is still present in a deduplication-relevant state.

**This reduction is not a guarantee of exactly-once side-effect execution.** If the previous BullMQ job has already been removed (e.g. via `removeOnComplete`, `removeOnFail`, or an age-based removal policy), the recovered row may produce a second enqueue. Therefore:

- The PostgreSQL `outbox_jobs.job_id UNIQUE` constraint is the **authoritative** idempotency anchor at the durable-write boundary (INVARIANT-16).
- The downstream worker's side effect MUST be **independently idempotent** with respect to `job_id`.
- BullMQ's `jobId` deduplication MUST NOT be treated as the sole idempotency mechanism for any side effect.

### 12.6 Rebuild integration

`system.rebuild` performs two distinct responsibilities:

1. **Outbox dispatch recovery** — restores stale `DISPATCHING` rows to `PENDING` and triggers a dispatch cycle.
2. **Domain-state rebuild** — derives missing work from durable domain state (e.g. `webhook_events.status = 'RECEIVED'` without a corresponding outbox row after cleanup, `publications.status = 'SCHEDULED'`).

Both responsibilities are idempotent. Running `system.rebuild` twice must not produce duplicate publications, duplicate responses, or duplicate webhook processing.

### 12.7 Cleanup

A dedicated `system.outbox.cleanup` job deletes `DISPATCHED` rows older than `OUTBOX_CLEANUP_RETENTION_DAYS`. Cleanup is independent from `system.rebuild` and runs on its own cron schedule.

`PENDING`, `DISPATCHING`, and `FAILED` rows are never deleted by cleanup.

---

## 13. Worker Execution and Operational Observability

DB v1 does not persist every worker execution attempt as a canonical database entity.

Transient queue state, retry metadata, execution timing, and worker-level diagnostic information are owned by the Redis/BullMQ execution layer.

PostgreSQL remains authoritative for:

```text
durable pipeline state
canonical artifacts
provenance
endpoint health
webhook subscription health
business history
audit history
outbox intent
```

The v1.1–v1.3.1 additions do not introduce a worker execution history table. `webhook_deliveries`, `interaction_response_attempts`, and `interaction_response_reconciliations` are business-history tables for external side effects, not generic worker execution logs.

`system_logs` may persist selected structured operational records, but it is not a mirror of BullMQ job state. `job_id` in `system_logs` is a correlation identifier only.

A future `EndpointRun` or equivalent execution-history entity may be introduced if operational requirements justify persistent execution analytics, historical run metrics, SLA analysis, or long-term diagnostics.

Such an entity must not become a duplicate representation of Redis/BullMQ queue state.

---

## 14. Provenance and Lineage Integrity

Provenance is immutable and cross-cutting.

The database records lineage through:

```text
provenance_events
```

Each event identifies:

```text
target_entity_type
target_entity_id
endpoint_id
phase
method
artifact_hash
observed_at
```

Phases are:

```text
DISCOVERY
ACQUISITION
EXTRACTION
```

The `method` value must be compatible with the phase according to the domain contract.

The provenance target is intentionally polymorphic because a single lineage mechanism spans:

```text
DISCOVERED_RESOURCE
RAW_RESOURCE
SOURCE_ITEM
CONTENT_ITEM
CONTENT_VERSION
```

Provenance events are never updated as part of normal pipeline processing.

---

## 15. Discovery Identity and Multi-Path Discovery

`discovered_resources.canonical_url` is the canonical candidate identity and is unique.

Individual detection events are stored in:

```text
discovery_observations
```

Therefore:

```text
RSS endpoint ─────┐
Sitemap endpoint ─┼→ same discovered_resources row
HTML endpoint ────┘
```

The model intentionally separates:

```text
candidate identity
        ≠
observation event
```

This allows the platform to preserve complete multi-path discovery history without creating duplicate candidate identities for every endpoint.

---

## 16. Canonical Content Identity

The canonical content layer is independent from source and discovery identity.

The identity chain is:

```text
Source
  ↓
SourceEndpoint
  ↓
DiscoveryObservation
  ↓
DiscoveredResource
  ↓
RawResource
  ↓
SourceItem
  ↓
ContentItem
```

A SourceItem may map to a ContentItem only after normalization.

A ContentItem is identified by its canonical URL at the canonical content layer.

Alternate URLs are stored separately in `content_urls`.

Fingerprints are independent of URL identity and are used for duplicate detection.

---

## 17. Deduplication and Clustering Persistence

### Deduplication

`content_fingerprints` stores algorithm-specific structural fingerprints.

`duplicate_matches` stores the evidence produced by duplicate detection.

These are intentionally separate responsibilities:

```text
Fingerprint
    ↓
candidate match detection
    ↓
DuplicateMatch evidence
    ↓
canonical identity decision
```

The database does not treat a fingerprint match as automatic canonicalization.

### Clustering

`stories` represents thematic grouping.

`story_members` represents membership evidence and assignment metadata.

```text
ContentItem N:M Story
```

Story membership is independent from Source identity and independent from duplicate identity.

---

## 18. Query Patterns

### 18.1 Webhook ingress deduplication

```sql
INSERT INTO webhook_events (idempotency_key, ...)
VALUES (...)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id;
```

### 18.2 Pending webhook dispatch

```sql
SELECT * FROM outbox_jobs
WHERE status = 'PENDING'
ORDER BY created_at
LIMIT $1
FOR UPDATE SKIP LOCKED;
```

### 18.3 Stale webhook processing recovery

```sql
SELECT id FROM webhook_events
WHERE status IN ('RECEIVED', 'FAILED')
   OR (status = 'PROCESSING' AND updated_at < now() - interval '5 minutes');
```

### 18.4 Interaction lookup by external identity

```sql
SELECT * FROM external_interactions
WHERE provider = $1 AND external_interaction_id = $2;
```

### 18.5 Response reconciliation candidates

```sql
SELECT id FROM interaction_responses
WHERE status = 'UNKNOWN'
   OR (status = 'SCHEDULED' AND scheduled_at < now() - interval '5 minutes');
```

### 18.6 Credential expiry scan

```sql
SELECT * FROM provider_credentials
WHERE credential_type = 'PAGE_ACCESS_TOKEN'
  AND expires_at < now() + interval '7 days'
  AND status IN ('VALID', 'EXPIRING');
```

### 18.7 Credential health for a destination

```sql
SELECT * FROM provider_credentials
WHERE scope = 'DESTINATION' AND destination_id = $1;
```

### 18.8 Publication lookup by external post ID

```sql
SELECT id FROM publications WHERE external_post_id = $1;
```

Served by the partial index `publications_external_post_id_idx`.

### 18.9 Webhook subscription health lookup

```sql
SELECT * FROM webhook_subscription_health
WHERE subscription_id = $1;
```

### 18.10 Subscription health recovery scan

```sql
SELECT subscription_id FROM webhook_subscription_health
WHERE last_failure_at > last_success_at
   OR last_success_at IS NULL;
```

### 18.11 Webhook endpoint resolution (single-App scope)

```sql
SELECT id, verify_token_encrypted, verify_token_key_version
FROM webhook_endpoints
WHERE provider = 'META' AND status = 'ACTIVE';
```

### 18.12 Token rotation dual-write transaction

```sql
BEGIN;
  -- Row lock to satisfy INVARIANT-18 compare-and-abort semantics
  SELECT id, verify_token_encrypted, verify_token_key_version
  FROM webhook_endpoints
  WHERE id = :endpoint_id
  FOR UPDATE;

  -- Endpoint write with endpoint AAD
  UPDATE webhook_endpoints
  SET verify_token_encrypted   = :new_ct_endpoint,
      verify_token_key_version = :new_kv,
      last_rotated_at          = now(),
      updated_at               = now()
  WHERE id = :endpoint_id;

  -- Every affected subscription write with its own destination AAD
  UPDATE webhook_subscriptions
  SET verify_token_encrypted   = :new_ct_per_subscription,
      verify_token_key_version = :new_kv,
      last_rotated_at          = now(),
      updated_at               = now()
  WHERE endpoint_id = :endpoint_id;

  -- Mandatory audit entry
  INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
  VALUES ('ROTATE_VERIFY_TOKEN', 'WEBHOOK_ENDPOINT', :endpoint_id,
          jsonb_build_object('affected_subscriptions', :affected_count));
COMMIT;
```

The `:new_ct_per_subscription` value is a distinct ciphertext per row, produced with that subscription's own `META:WEBHOOK_VERIFY_TOKEN:<destination_id>` AAD. A single shared ciphertext MUST NOT be reused across subscriptions (INVARIANT-17).

### 18.13 Preservation evidence digest write (INVARIANT-19)

```sql
INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
VALUES (
  'PRESERVATION_EVIDENCE',
  'MIGRATION',
  NULL,
  jsonb_build_object(
    'table',             :table_name,
    'pre_digest',        :sha256_hex_pre,
    'post_digest',       :sha256_hex_post,
    'pre_row_count',     :row_count_pre,
    'post_row_count',    :row_count_post,
    'excluded_columns',  :excluded_columns_json,
    'baseline_audit_id', :baseline_audit_id
  )
);
```

One row per protected table, written by `0016 MIGRATE` after the post-migration snapshot is complete and before Hard Gate #1 is declared satisfied. The digest serialization is defined in §2.8. The `pre_digest` and `baseline_audit_id` values are copied verbatim from the immutable baseline record captured by §18.14.

### 18.14 Immutable preservation baseline capture (INVARIANT-22)

```sql
BEGIN;

INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
VALUES
  ('PRESERVATION_BASELINE_CAPTURED', 'MIGRATION', NULL,
   jsonb_build_object(
     'table',            :table_1,
     'pre_digest',       :sha256_hex_pre_1,
     'pre_row_count',    :row_count_pre_1,
     'excluded_columns', :excluded_columns_json_1,
     'captured_at',      now(),
     'migration_run_id', :run_id
   )),
  ('PRESERVATION_BASELINE_CAPTURED', 'MIGRATION', NULL,
   jsonb_build_object(
     'table',            :table_2,
     'pre_digest',       :sha256_hex_pre_2,
     'pre_row_count',    :row_count_pre_2,
     'excluded_columns', :excluded_columns_json_2,
     'captured_at',      now(),
     'migration_run_id', :run_id
   )),
  -- ... one row per protected table ...
  ('PRESERVATION_BASELINE_CAPTURED', 'MIGRATION', NULL,
   jsonb_build_object(
     'table',            :table_N,
     'pre_digest',       :sha256_hex_pre_N,
     'pre_row_count',    :row_count_pre_N,
     'excluded_columns', :excluded_columns_json_N,
     'captured_at',      now(),
     'migration_run_id', :run_id
   ));

COMMIT;
```

Written by `0016 MIGRATE` step 1a, in a single transaction, committed before any `0016` data modification begins. Once committed, these rows MUST NOT be modified or deleted by any subsequent step, including recovery attempts (INVARIANT-22, §5.33).

---

## 19. Migration Dependency Order

The dependency order below reflects the **45 persistent tables** plus two non-table, non-persistence steps. The numbering lists **47 steps in total**, but only **45 of them are persistence tables**. The remaining two steps are marked explicitly as non-table phases.

```text
PHASE 1 — Extension step (no table created)

 1. extensions (pgcrypto)                          [non-table step]

PHASE 2 — 45 persistent tables in dependency order

 2. roles                                          [table 1 of 45]
 3. users                                          [table 2 of 45]
 4. destinations                                   [table 3 of 45]
 5. sources                                        [table 4 of 45]
 6. source_endpoints                               [table 5 of 45]
 7. source_endpoint_health                         [table 6 of 45]
 8. discovered_resources                           [table 7 of 45]
 9. discovery_observations                         [table 8 of 45]
10. provenance_events                              [table 9 of 45]
11. raw_resources                                  [table 10 of 45]
12. stories                                        [table 11 of 45]
13. content_items                                  [table 12 of 45]
14. content_versions                               [table 13 of 45]
15. source_items                                   [table 14 of 45]
16. content_entities                               [table 15 of 45]
17. content_categories                             [table 16 of 45]
18. content_fingerprints                           [table 17 of 45]
19. duplicate_matches                              [table 18 of 45]
20. content_urls                                   [table 19 of 45]
21. story_members                                  [table 20 of 45]
22. images                                         [table 21 of 45]
23. image_rights                                   [table 22 of 45]
24. publication_candidates                         [table 23 of 45]
25. moderation_actions                             [table 24 of 45]
26. publications                                   [table 25 of 45]
27. publication_attempts                           [table 26 of 45]
28. publication_reconciliations                    [table 27 of 45]
29. system_config                                  [table 28 of 45]
30. config_audit_log                               [table 29 of 45]
31. ai_usage                                       [table 30 of 45]
32. system_logs                                    [table 31 of 45]
33. notifications                                  [table 32 of 45]
34. audit_logs                                     [table 33 of 45]

PHASE 3 — Post-creation constraint step (no table created)

35. POST-CREATION CONSTRAINT                       [non-table step]
    content_items.current_version_id FK
    (added after content_versions exists; see §5.11)

PHASE 4 — Remaining 12 persistent tables

36. webhook_endpoints                              [table 34 of 45]
37. webhook_subscriptions                          [table 35 of 45]
38. webhook_subscription_health                    [table 36 of 45]
39. webhook_events                                 [table 37 of 45]
40. webhook_deliveries                             [table 38 of 45]
41. external_interactions                          [table 39 of 45]
42. provider_credentials                           [table 40 of 45]
43. interaction_responses                          [table 41 of 45]
44. interaction_response_attempts                  [table 42 of 45]
45. interaction_moderation_actions                 [table 43 of 45]
46. interaction_response_reconciliations           [table 44 of 45]
47. outbox_jobs                                    [table 45 of 45]
```

**Summary:**

```text
45  persistent tables
 1  extension step   (pgcrypto)
 1  constraint step  (content_items.current_version_id FK)
---
47  total steps in the dependency order
```

The 47-step numbering reflects the two non-table phases. The persistence table count remains **45** and MUST NOT be interpreted as 47.

`webhook_subscriptions` is created after `webhook_endpoints` (step 36), which it references via `endpoint_id`.

`webhook_subscription_health` is created after `webhook_subscriptions`.

`outbox_jobs` holds no foreign keys. This is deliberate: the outbox is a platform primitive whose lifecycle must not be coupled to any domain entity.

No `source_cursors` or `source_health` table is created.

---

## 20. Migration Strategy

Production schema changes strictly follow the zero-downtime four-phase protocol:

1. **EXPAND**: Add new tables, columns, or constraints in a backward-compatible manner. Existing application code continues to run unchanged.
2. **MIGRATE**: Deploy application code that writes to both old and new structures (or reads from the expanded schema safely). Backfill historical data where necessary.
3. **SWITCH**: Switch read and write operations entirely to the new schema elements. Deprecate legacy paths.
4. **CONTRACT**: Remove obsolete columns, tables, or constraints once verification confirms no residual dependency.

No breaking column renames or type transformations may occur in a single atomic migration.

### 20.0 Migration paths and the semantics of "zero-downtime"

DB v1.3.1 has **two distinct, non-mergeable migration paths**. They are documented separately and MUST NOT be treated as a single migration history.

The `EXPAND → MIGRATE → SWITCH → CONTRACT` protocol preserves **zero-downtime for the schema**. It does not guarantee that every application write path remains available without interruption at every instant during the migration. Specifically:

- During `0016 MIGRATE`, application write paths to `external_interactions`, `webhook_subscriptions`, and `webhook_endpoints` are subject to the migration fence (INVARIANT-08). They either fail closed or participate in the migration lock protocol.
- The accurate characterization is **"zero-downtime schema migration + bounded write fence"**: schema changes never require taking the database offline, but a well-defined subset of application writes is deliberately refused or deferred during a bounded window while the fence is held.
- This is a deliberate design choice. It is not a defect in the migration protocol. Downstream documentation, runbooks, and operator-facing communication MUST use this terminology.

Whenever the phrase "zero-downtime" appears in this document, in isolation, in an operator runbook derived from it, or in any higher-level document that cites this contract, it MUST be read as **"zero-downtime schema migration + bounded write fence"** unless the surrounding text explicitly states otherwise.

#### Path A — Upgrade from an existing v1.2 production deployment

```text
v1.2 Baseline (migrations 0000–0014 applied; production business data present)
    ↓
0015 EXPAND
    ↓
Compatibility Bridge deployment
    ↓
0016 MIGRATE (+ Hard Gate #1)
    ↓
0017 SWITCH (dual-write; rollback window)
    ↓
Hard Gate #2
    ↓
0018 CONTRACT
    ↓
v1.3.1 target
```

Path A applies to deployments that already have a populated v1.2 schema with active `webhook_subscriptions`, `external_interactions`, `provider_credentials`, and durable business results.

**Preservation is normative (INVARIANT-14).** All existing durable business data MUST be preserved as defined by §2.6, §2.7, INVARIANT-19, and INVARIANT-22. The migration MUST NOT replace the existing database with a greenfield schema.

#### Path B — Greenfield deployment

```text
Consolidated v1.3.1 baseline migration
    ↓
v1.3.1 target
```

Path B applies to new deployments that have no prior data. The consolidated baseline creates all 45 tables directly in their target v1.3.1 form, with no legacy columns, no transitional nullable states, and no Bridge.

**A greenfield deployment MUST NOT apply migrations `0015`–`0018`.** Those migrations exist solely to transition an existing deployment to the v1.3.1 target state. Applying them on a greenfield baseline would attempt to operate on columns and tables that do not exist in the target state and would fail.

**An existing production deployment MUST NOT be collapsed to a greenfield baseline.** Doing so would discard existing `webhook_subscriptions` ciphertext, `external_interactions` history, `provider_credentials`, and durable business data without a controlled migration.

The choice between Path A and Path B is determined at deployment provisioning time and is recorded in the deployment's migration journal.

### 20.1 Drizzle migration chain (Path A only)

The following chain applies **only** to Path A (existing deployment upgrade).

```text
0000_awesome_echo                              roles, users, destinations, pgcrypto
0001_clammy_doctor_octopus                     outbox_jobs
0002_mean_baron_zemo                           webhook_subscriptions, webhook_subscription_health,
                                               webhook_events, webhook_deliveries,
                                               external_interactions
0003_lean_captain_cross                        sources, source_endpoints, source_endpoint_health
0004_puzzling_mentallo                         discovered_resources, discovery_observations,
                                               provenance_events, raw_resources
0005_chunky_mongoose                           stories, content_items, content_versions, source_items
0006_flaky_gauntlet                            content_entities, content_categories,
                                               content_fingerprints, duplicate_matches,
                                               content_urls, story_members
0007_worthless_leader                          images, image_rights
0008_easy_catseye                              publication_candidates, moderation_actions,
                                               publications, publication_attempts,
                                               publication_reconciliations
0009_confused_scourge                          external_interactions.publication_id FK
0010_flashy_patriot                            provider_credentials
0011_natural_orphan                            interaction_responses, interaction_response_attempts,
                                               interaction_moderation_actions,
                                               interaction_response_reconciliations
0012_groovy_mephisto                           system_config, config_audit_log,
                                               ai_usage, system_logs,
                                               notifications, audit_logs
0013_seed_system_config                        seed (interaction_response_rules,
                                               interaction_response_templates,
                                               max_per_hour, min_interval)
0014_seed_rate_limit_budgets                   seed (meta.rate_limit.budgets)
0015_webhook_endpoints_expand                  webhook_endpoints; webhook_subscriptions.endpoint_id;
                                               external_interactions.provider (NULLABLE)
0016_webhook_endpoints_migrate                 backfill: endpoint_id, provider, crypto re-encryption,
                                               CREATE UNIQUE INDEX CONCURRENTLY
0017_webhook_endpoints_switch                  application deploys v1.3 code with dual-write
0018_webhook_endpoints_contract                endpoint_id NOT NULL, provider NOT NULL,
                                               drop verify_token_*, drop legacy unique index
```

The `pgcrypto` extension is created in `0000` and never re-declared.

### 20.2 Phase specifications (Path A)

#### 20.2.1 `0015 — EXPAND`

```sql
CREATE TABLE webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider varchar(32) NOT NULL,
  name text NOT NULL,
  verify_token_encrypted text NOT NULL,
  verify_token_key_version integer NOT NULL CHECK (verify_token_key_version > 0),
  status varchar(32) NOT NULL CHECK (status IN ('ACTIVE', 'PAUSED', 'DISABLED')),
  last_verified_at timestamptz,
  last_rotated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, name)
);
CREATE INDEX webhook_endpoints_status_idx ON webhook_endpoints(status);

ALTER TABLE webhook_subscriptions
  ADD COLUMN endpoint_id uuid REFERENCES webhook_endpoints(id) ON DELETE RESTRICT;
CREATE INDEX webhook_subscriptions_endpoint_id_idx ON webhook_subscriptions(endpoint_id);

ALTER TABLE external_interactions
  ADD COLUMN provider varchar(32);
```

**No index is created on `external_interactions(provider, external_interaction_id)` in `0015`.** The authoritative unique index is created in `0016` only (INVARIANT-15). Creating a non-unique transitional index here would leave an unused index in the target state and violate §8 index discipline.

All pre-existing columns, constraints, and indexes remain 100% active and unmodified (INVARIANT-02, INVARIANT-14). The set of allowed and forbidden transformations is fixed by §2.6.

#### 20.2.2 Compatibility Bridge deployment

Before `0016 MIGRATE`, all application instances MUST run Bridge code. The Bridge:

- On subscription creation: resolves/creates the endpoint, dual-encrypts the token (destination AAD + endpoint AAD), writes both representations in one transaction, writes `endpoint_id` and `provider`. **If the deployment's single endpoint already exists and its decrypted plaintext differs from the incoming plaintext, the Bridge MUST abort the transaction without modifying any state (INVARIANT-18).**
- On token rotation: reads the endpoint ID, dual-encrypts the new token, updates the endpoint token and `last_rotated_at`, updates the legacy subscription token for **every** subscription referencing the endpoint, commits atomically. This path is governed by INVARIANT-17 and §18.12.
- On interaction ingestion: writes `provider = 'META'` alongside legacy fields.
- On endpoint resolution: uses PostgreSQL `UNIQUE (provider, name)` with an atomic upsert. The `name` value is read from deployment configuration (`META_APP_NAME`), NOT derived from any subscription or destination row (INVARIANT-13).

The Bridge observes the advisory lock acquired by `0016 MIGRATE` (INVARIANT-08) and MUST fail closed if it observes the lock.

**Migration fence (INVARIANT-08).** The advisory lock is cooperative. All application write paths capable of inserting, updating, or deleting rows in `external_interactions`, `webhook_subscriptions`, or `webhook_endpoints` — not just the Bridge — MUST observe the lock and either fail closed or participate in the migration lock protocol. No writer may bypass the fence. CI checks must verify that every write path to these three tables is wrapped by the lock-aware guard.

**Token rotation fence (INVARIANT-17).** Any token rotation, whether performed by the Bridge or by v1.3 application code during SWITCH, MUST update every affected subscription's legacy ciphertext in the same transaction as the endpoint write. Partial rotation — updating the endpoint but not every referencing subscription — is a contract violation and MUST be rejected by CI checks that assert all `webhook_endpoints.verify_token_encrypted` writers also touch every referencing `webhook_subscriptions` row while the migration window is open.

**Bridge upsert conflict fence (INVARIANT-18).** The Bridge endpoint upsert path MUST use `SELECT ... FOR UPDATE` on the deployment's endpoint row (or an equivalent atomic operation) and MUST abort the transaction when the decrypted existing plaintext differs from the incoming plaintext. Silent overwrite is a contract violation. CI checks MUST assert that every code path that writes to `webhook_endpoints.verify_token_encrypted` performs the compare step against the existing ciphertext's decrypted value and fails closed on mismatch.

#### 20.2.3 `0016 — MIGRATE`

**Session requirement (INVARIANT-20).** The `0016 MIGRATE` phase MUST execute on a **single dedicated PostgreSQL session** for its entire duration, including the non-transactional `CREATE UNIQUE INDEX CONCURRENTLY` step and the post-build catalog validation. The session-level advisory lock acquired at the start of `0016` is held for the life of the session and is NOT released by `COMMIT` or `ROLLBACK`. A connection-pooled implementation MUST pin a single physical connection to the entire `0016` phase and MUST NOT return it to the pool until the phase has completed or failed.

**Transaction/session state machine (INVARIANT-10, INVARIANT-20).** The full state machine for `0016` and Hard Gate #1, including transaction boundaries and session invariants, is defined normatively in §20.2.9. The steps below are the semantic content of each state; §20.2.9 defines the exact transaction/session boundaries between them.

On the dedicated session, the migration runner acquires a PostgreSQL advisory lock (`pg_advisory_lock(<fixed_key>)`) for the entire migration duration. While held:

**Step 1 — Capture immutable pre-migration preservation baseline (INVARIANT-22).**

This step MUST execute before any data modification by `0016`. It consists of a single transaction that writes one `PRESERVATION_BASELINE_CAPTURED` row per protected table:

```sql
BEGIN;

-- For each protected table T in the set listed in INVARIANT-19:
--   compute pre_digest[T] via §2.8 canonical-JSON serialization
--   compute pre_row_count[T]
--   INSERT INTO audit_logs (...) VALUES (
--     'PRESERVATION_BASELINE_CAPTURED', 'MIGRATION', NULL,
--     jsonb_build_object(
--       'table',            T,
--       'pre_digest',       pre_digest[T],
--       'pre_row_count',    pre_row_count[T],
--       'excluded_columns', excluded_columns[T],
--       'captured_at',      now(),
--       'migration_run_id', :run_id
--     )
--   );

COMMIT;
```

After this transaction commits, the baseline rows are **immutable**. No subsequent `0016` step, no recovery attempt, and no operator procedure may modify or delete them (INVARIANT-22, §5.33).

If `PRESERVATION_BASELINE_CAPTURED` rows already exist for the current `0016` phase (e.g. from a previous attempt), Step 1 MUST NOT write a second set. Instead, the runner MUST detect the existing set and treat it as the authoritative baseline. See §20.2.8 for the recovery decision procedure.

**Step 1b — Validate single-App scope precondition.**

Let `META_APP_NAME` be the deployment-level App identity value read from configuration.

```sql
SELECT COUNT(*) FROM webhook_endpoints
WHERE provider = 'META' AND name = current_setting('app.meta_app_name');
```

Required result: exactly 1 row.

- If 0 → abort (Bridge has not yet created the endpoint; migration does not create it).
- If >1 → abort (multi-App scope violation; INVARIANT-12).

The migration does NOT create `webhook_endpoints` rows. Endpoint creation is a Bridge or operator responsibility.

**Step 2 — Deterministic `endpoint_id` backfill.**

The subscription → endpoint mapping is deterministic and derived solely from deployment configuration:

```sql
UPDATE webhook_subscriptions
SET endpoint_id = (
  SELECT id FROM webhook_endpoints
  WHERE provider = 'META'
    AND name = current_setting('app.meta_app_name')
)
WHERE endpoint_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM webhook_subscriptions WHERE endpoint_id IS NULL) THEN
    RAISE EXCEPTION 'INVARIANT-13 violation: unmapped webhook_subscriptions remain';
  END IF;
END $$;
```

The algorithm does not depend on:

- the number of subscriptions,
- the number of distinct destination rows,
- the plaintext or ciphertext of any verify token,
- the `webhook_subscriptions` legacy columns.

It depends only on the deployment-level `META_APP_NAME` configuration input, satisfying INVARIANT-01.

**Step 3 — Dual-representation re-encryption.**

For each subscription:

- Decrypt legacy ciphertext with `META:WEBHOOK_VERIFY_TOKEN:<destination_id>`.
- Encrypt plaintext with `META:WEBHOOK_VERIFY_TOKEN:<endpoint_id>`.
- If the endpoint already has ciphertext (Bridge created), decrypt the endpoint ciphertext with the endpoint AAD and compare plaintext to the legacy plaintext. On mismatch, abort (INVARIANT-09 and INVARIANT-18).
- Otherwise, write to `webhook_endpoints.verify_token_encrypted` and `verify_token_key_version`.
- Legacy subscription columns are never modified (INVARIANT-02).

Because Step 1b guarantees exactly one endpoint, all subscriptions must re-encrypt to the same endpoint. If any two subscriptions decrypt to different plaintexts, abort.

**Step 4 — Provider backfill.**

```sql
UPDATE external_interactions SET provider = 'META' WHERE provider IS NULL;
```

If any row cannot be attributed to Meta, abort.

**Step 5 — Collision scan and unique index build.**

**Step 5a — Collision scan** (inside a `SERIALIZABLE` transaction, INVARIANT-10):

```sql
SELECT provider, external_interaction_id, COUNT(*) AS c
FROM external_interactions
GROUP BY provider, external_interaction_id
HAVING COUNT(*) > 1;
```

Zero rows required. On any row, abort the migration.

**Step 5b — Unique index build** (outside the `SERIALIZABLE` transaction; `CREATE INDEX CONCURRENTLY` cannot run inside a transaction).

The migration runner MUST first inspect the existing index state. `IF NOT EXISTS` alone is insufficient.

```sql
SELECT
  i.indisunique AS is_unique,
  i.indisvalid  AS is_valid,
  pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
WHERE c.relname = 'external_interactions_provider_external_id_uq';
```

Three cases:

1. **No row returned** → the index does not exist. Proceed to `CREATE UNIQUE INDEX CONCURRENTLY`.
2. **One row returned, `is_unique = true`, `is_valid = true`, and `definition` matches the expected definition** → the index already exists in its target form. Skip creation.
3. **One row returned, but `is_unique = false` OR `is_valid = false` OR `definition` differs** → the index exists in a wrong or invalid state. Drop it (`DROP INDEX CONCURRENTLY IF EXISTS external_interactions_provider_external_id_uq`) and recreate.

The expected definition:

```text
CREATE UNIQUE INDEX external_interactions_provider_external_id_uq
  ON public.external_interactions
  USING btree (provider, external_interaction_id)
```

Creation statement:

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  external_interactions_provider_external_id_uq
ON external_interactions (provider, external_interaction_id);
```

If the build fails or leaves the index invalid, drop the index and abort. The resulting state is the partial-0016 state described in §20.2.8; it is NOT a return to the `0015` + Bridge state.

**Step 5c — Post-build catalog validation.**

After the `CREATE UNIQUE INDEX CONCURRENTLY` statement returns, the migration MUST re-run the `pg_index` / `pg_class` inspection on the same dedicated session (INVARIANT-20) and verify:

```text
is_unique = true
is_valid  = true
definition matches the expected definition
```

If any of these fail, drop the index and abort. The resulting state is the partial-0016 state described in §20.2.8.

**Step 6 — Post-migration preservation snapshot and comparison.**

For every protected table listed in INVARIANT-19, compute the post-migration content-level digest and row count using the §2.8 specification.

The migration runner MUST load the **immutable baseline** for the current `0016` phase — the `PRESERVATION_BASELINE_CAPTURED` rows written by Step 1 — and MUST compare the post-migration digest against the baseline's `pre_digest`. The runner MUST NOT recompute the pre-migration digest from the current state (INVARIANT-22).

- If the immutable baseline rows are missing for any protected table → abort the migration with a hard failure. The deployment enters the partial-0016 state (§20.2.8), and an incident MUST be raised. Do not recompute the baseline from the current state.
- If `post_digest[T] != pre_digest[T]` for any protected table → abort the migration, do not proceed to Hard Gate #1. The resulting state is the partial-0016 state described in §20.2.8, and an incident MUST be raised.
- Otherwise, write one `PRESERVATION_EVIDENCE` row per protected table to `audit_logs` as defined in §18.13, with `baseline_audit_id` referencing the corresponding immutable baseline row.

**Idempotency (INVARIANT-03):** re-running the migration MUST verify byte-equality of the re-derived endpoint ciphertext with the existing ciphertext. On mismatch, fail.

**Preservation (INVARIANT-14 and §2.6):** no rows in `publications`, `publication_attempts`, `publication_reconciliations`, `webhook_events`, `webhook_deliveries`, `provider_credentials`, `interaction_responses`, `interaction_response_attempts`, `interaction_moderation_actions`, `interaction_response_reconciliations`, or `outbox_jobs` are deleted, rewritten, or semantically reinterpreted by this migration. The only allowed mutations are those listed in §2.6. Compliance is asserted by Step 6.

#### 20.2.4 Hard Gate #1

Hard Gate #1 is a **sequence** of validation steps, not a single atomic check. The order is normative. All steps execute on the same dedicated session (INVARIANT-20). The transaction/session boundaries between steps are defined in §20.2.9.

**Step A — `SERIALIZABLE` data validation.**

Executed inside a single `SERIALIZABLE` transaction (INVARIANT-10):

1. 100% of `webhook_endpoints` rows decrypt successfully with the endpoint AAD.
2. 100% of `webhook_endpoints` rows decrypt to the **same plaintext** as the corresponding legacy ciphertext (plaintext equality).
3. Zero `webhook_subscriptions` with `endpoint_id IS NULL`.
4. Zero `external_interactions` with `provider IS NULL`.
5. Zero `(provider, external_interaction_id)` collisions.

**Commit** the transaction if and only if all checks pass.

**Step B — Concurrent index build** (if not already present from §20.2.3 step 5b).

**Step C — Catalog validation.**

Verify via `pg_index` / `pg_class` that `external_interactions_provider_external_id_uq` exists, is unique, is valid, and matches the expected definition.

**Step D — Preservation evidence validation.**

Verify that §20.2.3 step 6 produced a `PRESERVATION_EVIDENCE` row for each protected table, and that:

- each such row's `pre_digest` matches the `pre_digest` in its referenced `PRESERVATION_BASELINE_CAPTURED` row (by `baseline_audit_id`);
- each such row's `post_digest` equals its `pre_digest`.

Absence of any required row, or any mismatch, is a Hard Gate #1 failure.

**Step E — Final Gate #1 assertion.**

Only after Steps A, B, C, and D all pass is Hard Gate #1 considered satisfied.

**On failure at any step:** abort, drop the incomplete index if any, and enter the partial-0016 state defined in §20.2.8. Do not proceed to `0017 SWITCH`.

The description "remain in the `0015` + Bridge state" used in earlier drafts of this contract is **superseded**: it is not achievable in general, because earlier steps of `0016` (endpoint_id backfill, provider backfill) may have already committed data changes. The accurate description is the partial-0016 state (§20.2.8).

#### 20.2.5 `0017 — SWITCH`

- Deploy v1.3 application code.
- Application reads webhook tokens from `webhook_endpoints` with the endpoint AAD.
- Application queries `external_interactions` by `(provider, external_interaction_id)`.
- **Mandatory dual-write (INVARIANT-07):** all mutations preserve both representations until Hard Gate #2.
- **Mandatory token rotation dual-write (INVARIANT-17):** token rotation updates the endpoint and every affected subscription in a single transaction, each with its own AAD.
- **Mandatory endpoint upsert conflict check (INVARIANT-18):** every endpoint write path performs the compare-and-abort check.

**Application rollback:** if v1.3 deployment fails, redeploy Bridge code. Because legacy columns remain intact and dual-write is active, rollback is lossless.

#### 20.2.6 Hard Gate #2

Required before `0018 CONTRACT`:

- Zero v1.2 / Bridge application instances active.
- Telemetry confirms zero reads of legacy `webhook_subscriptions.verify_token_*` columns.

Hard Gate #2 formally closes the application rollback window.

#### 20.2.7 `0018 — CONTRACT`

```sql
ALTER TABLE webhook_subscriptions DROP COLUMN verify_token_encrypted;
ALTER TABLE webhook_subscriptions DROP COLUMN verify_token_key_version;
ALTER TABLE webhook_subscriptions DROP COLUMN last_rotated_at;
ALTER TABLE webhook_subscriptions ALTER COLUMN endpoint_id SET NOT NULL;
ALTER TABLE webhook_subscriptions ALTER COLUMN provider SET NOT NULL;
ALTER TABLE external_interactions ALTER COLUMN provider SET NOT NULL;

DROP INDEX external_interactions_type_external_id_uq;
```

The provider-aware **unique index** `external_interactions_provider_external_id_uq` is already in place; it remains authoritative (INVARIANT-11). The `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE USING INDEX` variant is **not** used because the index was created with `CONCURRENTLY`.

**Contract assertion:** `0018` MUST fail if any target invariant is unmet (missing column, wrong nullability, missing foreign key, missing check constraint, invalid index, residual legacy column).

#### 20.2.8 Partial-0016 state and recovery contract

This subsection defines the state that the deployment occupies when `0016 MIGRATE` fails at any step after Step 1 has committed the immutable baseline. The partial-0016 state is a **recoverable transitional state**, not a rollback state.

**Definition.** The partial-0016 state is characterized by all of the following:

- The `0015` schema is fully applied (all `0015` DDL is committed).
- The Bridge is deployed and running in Compatibility Bridge mode.
- Zero or more of the following `0016` data changes have been committed:
  - The immutable `PRESERVATION_BASELINE_CAPTURED` row set for the current `0016` phase has been written and is authoritative.
  - `webhook_subscriptions.endpoint_id` has been backfilled for some or all rows.
  - `external_interactions.provider` has been set to `'META'` for some or all rows.
  - `webhook_endpoints.verify_token_encrypted` and `verify_token_key_version` have been written from the legacy plaintext for the deployment's single endpoint (either by the Bridge or by `0016` Step 3).
- The authoritative unique index `external_interactions_provider_external_id_uq` may or may not exist, and if it exists it may be in an INVALID state (a partial `CREATE UNIQUE INDEX CONCURRENTLY` interrupted before completion).
- The `PRESERVATION_EVIDENCE` rows for the protected tables may or may not have been written.
- The `0017 SWITCH` application code has NOT been deployed. The Bridge remains the active write path.

**Not a rollback.** The partial-0016 state is NOT equivalent to the `0015` + Bridge state that preceded `0016`. Attempting to force the deployment back to the pre-`0016` state by manual `UPDATE` or `DELETE` statements is a contract violation (INVARIANT-21). Recovery proceeds exclusively by re-running the migration runner.

**Recovery contract.**

1. The migration runner MUST be idempotent (INVARIANT-03). Re-execution on the partial-0016 state MUST converge to the target state.
2. Before any recovery action, the runner MUST acquire the advisory lock on a fresh dedicated session (INVARIANT-20). If the lock cannot be acquired because another session holds it, the runner MUST abort and report the contention.
3. The runner MUST write a `MIGRATION_RECOVERY_STARTED` row to `audit_logs` before beginning recovery.
4. The runner MUST first determine whether the immutable `PRESERVATION_BASELINE_CAPTURED` row set for the current `0016` phase exists (Step 3a). This decision is the pivot of the entire recovery contract:
   - **Step 3a — Baseline presence check.**
     ```sql
     SELECT COUNT(*) FROM audit_logs
     WHERE action = 'PRESERVATION_BASELINE_CAPTURED'
       AND metadata->>'migration_run_id' = :run_id;
     ```
     The expected count is exactly the number of protected tables listed in INVARIANT-19.
   - **Case 3a.1 — Baseline is complete.** The runner proceeds to Step 4 and uses the existing baseline as the sole comparison target. It MUST NOT recompute the baseline from the current state, and it MUST NOT write a second `PRESERVATION_BASELINE_CAPTURED` set (INVARIANT-22).
   - **Case 3a.2 — Baseline is absent.** The runner MUST determine whether any `0016` data modification has been committed, by checking at minimum:
     ```sql
     SELECT EXISTS (
       SELECT 1 FROM webhook_subscriptions WHERE endpoint_id IS NOT NULL
     ) OR EXISTS (
       SELECT 1 FROM external_interactions WHERE provider IS NOT NULL
     ) OR EXISTS (
       SELECT 1 FROM webhook_endpoints
     );
     ```
     - If **no** `0016` data modification has been committed, the runner MAY proceed with a fresh baseline capture (Step 1) as if this were the first attempt.
     - If **any** `0016` data modification has been committed, the runner MUST abort with a hard failure. A pre-migration baseline cannot be reconstructed after the fact, and proceeding with a recomputed baseline would silently defeat INVARIANT-14 (INVARIANT-22). An incident MUST be raised.
   - **Case 3a.3 — Baseline is partial.** The runner MUST abort with a hard failure and raise an incident. A partial baseline cannot be trusted as the comparison target, and recomputing the missing rows would produce a mixed-vintage baseline that violates INVARIANT-22.
5. The runner MUST re-execute `0016` from Step 1b. Steps whose work is already complete MUST be idempotent:
   - Step 1b (single-App scope check) is naturally idempotent.
   - Step 2 (`endpoint_id` backfill) is idempotent because the `WHERE endpoint_id IS NULL` predicate is a no-op for already-backfilled rows.
   - Step 3 (dual-representation re-encryption) MUST verify byte-equality of the re-derived endpoint ciphertext with the existing ciphertext (INVARIANT-03). On mismatch, it MUST fail with an explicit recovery mismatch error.
   - Step 4 (provider backfill) is idempotent because the `WHERE provider IS NULL` predicate is a no-op for already-backfilled rows.
   - Step 5a (collision scan) is a read-only operation.
   - Step 5b (unique index build) MUST use the catalog pre-check to detect and repair an INVALID index (as specified in §20.2.3 step 5b).
   - Step 5c (post-build catalog validation) is a read-only operation.
   - Step 6 (post-migration preservation snapshot) MUST compare against the **immutable baseline** loaded in step 4 above, NOT against a recomputed digest. If it differs from the baseline for any protected table, the runner MUST abort and raise an incident, even on a repeated recovery attempt.
6. After Step 6 succeeds on recovery, the runner proceeds to Hard Gate #1 as normal.

**Non-recoverable failure modes.** The following failure modes do not converge by re-running `0016`:

- A missing or partial `PRESERVATION_BASELINE_CAPTURED` set combined with committed `0016` data modifications (Case 3a.2 with modifications, or Case 3a.3).
- A protected-table pre/post digest mismatch against the immutable baseline (Step 6) indicates that durable business data was modified outside the Allowed matrix in §2.6. This is an incident and requires operator intervention with explicit authorization. Re-running `0016` MUST NOT proceed past Step 6.
- A preservation mismatch that is caused by an earlier failed run of `0016` itself (for example, a bug that modified a protected column) is also an incident. The runner MUST NOT silently overwrite the baseline or the mismatch.
- Any failure that requires dropping and recreating an object outside the objects listed in §8 requires a contract revision.

**Operator visibility.** Every entry and exit from the partial-0016 state MUST be accompanied by an `audit_logs` entry:

- `MIGRATION_RECOVERY_STARTED` on entry (before any recovery action).
- `MIGRATION_PHASE_COMPLETED` with `metadata.phase = '0016'` on successful exit.

The absence of `MIGRATION_PHASE_COMPLETED` with `metadata.phase = '0016'` after a deployment reaches Hard Gate #1 is a signal that the deployment is in the partial-0016 state and must be recovered.

**Relationship to `0018 CONTRACT`.** `0018 CONTRACT` MUST NOT execute while the deployment is in the partial-0016 state. The precondition check for `0018` MUST verify the presence of a `MIGRATION_PHASE_COMPLETED` row with `metadata.phase = '0016'` before proceeding.

#### 20.2.9 `0016` transaction/session state machine

This subsection formalizes the transaction and session sequencing of `0016` and Hard Gate #1. It is normative. Implementations MUST produce the same transaction boundaries and MUST hold the same session for the full sequence (INVARIANT-20).

**Legend.**

- `[T]` — executed inside a database transaction that commits or rolls back as a unit.
- `[NT]` — executed outside any transaction (PostgreSQL disallows this statement inside a transaction block).
- `[S]` — executed on the same dedicated session, with the session-level advisory lock held.
- `[RO]` — read-only, no transaction required (but must execute on the same session).

**Session invariant.** Every step below executes on a single dedicated PostgreSQL session. The session-level advisory lock is acquired once at the top of the sequence and released only on explicit unlock, session termination, or connection loss. `COMMIT` and `ROLLBACK` do not release the advisory lock (INVARIANT-20).

**State machine.**

```text
[SESSION START]
  │
  ├─ Acquire pg_advisory_lock(<fixed_key>)                        [S]
  │
  ├─ STEP 1a: Immutable baseline capture                          [T][S]
  │    BEGIN
  │      -- compute pre_digest[T] for every protected table T
  │      -- INSERT ... PRESERVATION_BASELINE_CAPTURED (one row per T)
  │    COMMIT
  │    (If baseline for this run_id already exists: skip write,
  │     load existing rows as the authoritative baseline.)
  │
  ├─ STEP 1b: Single-App scope validation                         [RO][S]
  │    SELECT COUNT(*) FROM webhook_endpoints ...
  │
  ├─ STEP 2: endpoint_id backfill                                 [T][S]
  │    BEGIN
  │      UPDATE webhook_subscriptions SET endpoint_id = ...
  │      -- assert no NULL endpoint_id remains
  │    COMMIT
  │
  ├─ STEP 3: dual-representation re-encryption                    [T][S]
  │    BEGIN
  │      -- for each subscription:
  │      --   decrypt legacy AAD, encrypt endpoint AAD
  │      --   if endpoint ciphertext exists: compare plaintext, abort on mismatch
  │      --   else: write endpoint ciphertext
  │    COMMIT
  │
  ├─ STEP 4: provider backfill                                    [T][S]
  │    BEGIN
  │      UPDATE external_interactions SET provider = 'META'
  │        WHERE provider IS NULL
  │    COMMIT
  │
  ├─ STEP 5a: collision scan                                      [T][S]
  │    BEGIN ISOLATION LEVEL SERIALIZABLE
  │      SELECT provider, external_interaction_id, COUNT(*) ...
  │        GROUP BY ... HAVING COUNT(*) > 1
  │      -- must return zero rows
  │    COMMIT
  │
  ├─ STEP 5b: unique index build                                  [NT][S]
  │    -- Pre-check via pg_index / pg_class
  │    -- DROP INDEX CONCURRENTLY IF EXISTS ... (only on wrong/invalid state)
  │    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  │      external_interactions_provider_external_id_uq
  │      ON external_interactions (provider, external_interaction_id);
  │    -- NOTE: not inside a transaction
  │
  ├─ STEP 5c: post-build catalog validation                       [RO][S]
  │    -- SELECT from pg_index / pg_class
  │    -- verify is_unique, is_valid, definition
  │
  ├─ STEP 6: preservation evidence comparison                     [T][S]
  │    BEGIN
  │      -- compute post_digest[T] for every protected table T
  │      -- load immutable baseline rows for :run_id
  │      -- for each T: assert post_digest[T] = baseline.pre_digest[T]
  │      -- INSERT ... PRESERVATION_EVIDENCE (one row per T)
  │    COMMIT
  │
  ├─ HARD GATE #1
  │    Step A: SERIALIZABLE data validation                       [T][S]
  │      BEGIN ISOLATION LEVEL SERIALIZABLE
  │        -- decrypt check, plaintext equality, NULL checks, collision check
  │      COMMIT
  │    Step B: (index already built in 5b; no-op if complete)     [RO][S]
  │    Step C: catalog validation                                  [RO][S]
  │    Step D: preservation evidence validation                    [RO][S]
  │    Step E: final Gate #1 assertion
  │
  ├─ On success:
  │    INSERT ... audit_logs ('MIGRATION_PHASE_COMPLETED',
  │                           metadata.phase = '0016')            [T][S]
  │
  ├─ On any failure:
  │    Insert or update the partial-0016 state marker as needed
  │    INSERT ... audit_logs ('MIGRATION_RECOVERY_STARTED') if
  │      a subsequent recovery run begins
  │    Do NOT release the advisory lock until the session ends
  │
  └─ Release pg_advisory_unlock(<fixed_key>)  (or session end)    [S]
```

**Transaction boundary rules.**

1. **No statement in §20.2.3 step 5b may execute inside a transaction.** `CREATE INDEX CONCURRENTLY` and `DROP INDEX CONCURRENTLY` MUST be issued as bare statements on the dedicated session, with no surrounding `BEGIN`/`COMMIT`.
2. **Step 1a MUST commit before Step 2 begins.** The immutable baseline is only immutable if it is durably committed before any modifying step can run (INVARIANT-22).
3. **Step 5a MUST run in a `SERIALIZABLE` transaction.** The collision scan and the unique-index build are both required to see a consistent view; the collision scan must not race with concurrent writers, which is why INVARIANT-08 holds the migration fence across the entire sequence.
4. **Hard Gate #1 Step A MUST run in a `SERIALIZABLE` transaction.** The multi-point consistency assertions (plaintext equality, NULL scan, collision scan) are only meaningful together.
5. **No application write path may interleave.** The advisory lock is held for the full sequence; application writers MUST observe the fence (INVARIANT-08).
6. **Session pinning is mandatory.** A connection-pooled implementation that returns the connection to the pool between any two steps above violates INVARIANT-20.
7. **On any rollback of a transactional step, the deployment remains in the partial-0016 state (§20.2.8).** The state machine does not attempt to roll back earlier committed steps. Recovery proceeds by re-running from Step 1a and following the recovery decision procedure (§20.2.8 step 3a).

**Idempotency of the state machine.** Re-executing the state machine from the top on an already-partial state MUST converge:

- Step 1a detects and reuses the existing immutable baseline (Case 3a.1).
- Step 1b is naturally idempotent.
- Step 2 is a no-op for already-backfilled rows.
- Step 3 verifies byte-equality (INVARIANT-03) and is a no-op for already-written ciphertext.
- Step 4 is a no-op for already-backfilled rows.
- Step 5a is read-only.
- Step 5b repairs or skips the index as needed.
- Step 5c is read-only.
- Step 6 compares against the immutable baseline; a second match writes a duplicate `PRESERVATION_EVIDENCE` row only if the implementation does not deduplicate, which is acceptable (evidence rows are append-only and idempotent in content).

### 20.3 Path B — Greenfield baseline

For greenfield deployments without prior data, the entire v1.3.1 schema is created directly by a consolidated baseline migration set. The incremental `0015`–`0018` chain does not apply.

**The greenfield baseline must:**

- Create the `pgcrypto` extension.
- Create all 45 persistent tables in the dependency order specified in §19.
- Apply the **target-state** definitions from §5 directly, with no transitional columns.
- For `webhook_subscriptions`: include `endpoint_id` as `NOT NULL` and `provider` as `NOT NULL`; do not include `verify_token_encrypted`, `verify_token_key_version`, or `last_rotated_at`.
- For `external_interactions`: include `provider` as `NOT NULL` and enforce the `external_interactions_provider_external_id_uq` **unique index** on `(provider, external_interaction_id)`.
- For `webhook_endpoints`: create the table in its target form.
- For `provider_credentials`: use the two partial unique indexes.
- For `interaction_responses`: declare `destination_id NOT NULL` with `ON DELETE RESTRICT`.
- For all other tables: use the definitions in §5 as-is.

**The greenfield baseline must not:**

- Create legacy `verify_token_*` columns on `webhook_subscriptions`.
- Create the legacy `external_interactions_type_external_id_uq` index.
- Create a non-unique transitional index on `(provider, external_interaction_id)` (INVARIANT-15).
- Apply the `0015`–`0018` incremental migrations.
- Require a Compatibility Bridge deployment.
- Create a `webhook_endpoints` row automatically — the deployment's App identity (`META_APP_NAME`) is a provisioning input, and the initial endpoint row is created by provisioning, not by the schema baseline.

The greenfield baseline and Path A migrations produce the identical target state. They differ only in the presence or absence of transitional steps.

### 20.4 Migration validation

The migration must not silently introduce tables or provider-specific persistence structures outside this contract. Drizzle introspection must match this contract exactly.

---

## 21. Explicit Non-Goals

The following are outside the DB v1.3.1 persistence contract unless separately specified:

- publisher-specific HTML extraction schemas;
- crawler implementation details;
- HTTP client implementation;
- headless browser implementation;
- Redis/BullMQ internals;
- worker retry internals;
- generic worker execution history;
- AI model implementation;
- embedding engine implementation;
- publication adapter implementation;
- scheduling policy implementation;
- provider-specific credential storage beyond `provider_credentials`;
- authentication session/token persistence;
- final image status taxonomy;
- final image-rights taxonomy;
- canonical entity taxonomy;
- canonical category taxonomy;
- AI cost currency/unit;
- Messenger (`messages`) webhook handling;
- message threads on a single interaction (one response per interaction in DB v1);
- AI-generated response text (templates are deterministic in DB v1);
- multi-provider webhook support beyond Meta;
- multi-Meta-App support beyond one App per deployment (see §24, D-013);
- tenant-, account-, workspace-, or organization-level data isolation (see §2.5);
- analytics read models for Meta-specific aggregations.

These concerns may receive additional persistence structures in later architecture revisions, but they must not be silently added to DB v1.

---

## 22. Validation Requirements

### 22.1 Structural validation

- All 45 tables are present.
- All foreign keys have existing targets and correct directions.
- Every `ON DELETE SET NULL` action is applied only to a nullable referencing column (§4.5). In particular, `interaction_responses.destination_id` MUST be `NOT NULL` with `ON DELETE RESTRICT`. Any contract variant that pairs `NOT NULL` with `ON DELETE SET NULL` MUST be rejected.
- `outbox_jobs` has no foreign keys.
- Every unique business identity is expressed as a UNIQUE constraint or UNIQUE index.
- Every index corresponds to a documented query pattern.
- The `webhook_events` `CHECK` constraint on status and the `outbox_jobs` `CHECK` constraints on status and `dispatched_at` consistency are present.
- The `provider_credentials` partial unique indexes are present.
- The `webhook_subscriptions.fields` `CHECK (cardinality(fields) > 0)` is present.
- No non-unique transitional index on `(provider, external_interaction_id)` exists (INVARIANT-15).

### 22.2 Webhook validation

- `webhook_events.idempotency_key` is unique.
- `webhook_events.raw_payload` and `raw_body_hash` are immutable after insert.
- `webhook_events.signature_verified` is always `true`.
- `external_interactions` has a unique **index** on `(provider, external_interaction_id)`.
- `external_interactions.occurred_at` is monotonically non-decreasing per `(provider, external_interaction_id)`, enforced by the upsert predicate defined in §5.39 and D-018.
- `webhook_deliveries.attempt_number` is unique per event and strictly positive.
- No table stores a plaintext secret.
- `webhook_endpoints` is present with the exact columns in §5.34.
- `webhook_endpoints.name` is deployment-level App identity (INVARIANT-13), not derived from any subscription or destination.
- `webhook_subscriptions.endpoint_id` is `NOT NULL` after `0018`.
- `external_interactions.provider` is `NOT NULL` after `0018`.
- The target-state AAD `META:WEBHOOK_VERIFY_TOKEN:<endpoint_id>` is authoritative; the legacy AAD is migration-window-only.
- `webhook_events` lifecycle permits `DEAD_LETTER` as a distinct terminal state.
- INVARIANT-17 (token rotation dual-write) is asserted: every token rotation updates the endpoint and every affected subscription in the same transaction with per-row AADs.
- INVARIANT-18 (Bridge endpoint upsert conflict) is asserted: every endpoint write path decrypts the existing ciphertext and aborts the transaction on plaintext mismatch.

### 22.3 Credential validation

- `provider_credentials.encrypted_value` never contains a plaintext secret.
- `provider_credentials.encryption_key_version > 0` on every row.
- The `scope` / `destination_id` consistency invariant holds (both partial indexes enforce it).
- The two partial unique indexes correctly deduplicate APP and DESTINATION scopes.
- The legacy `COALESCE`-based expression index is not present.

### 22.4 Outbox validation

- `outbox_jobs.job_id` is unique.
- `outbox_jobs.payload` contains identifiers only.
- `outbox_jobs` has no foreign keys.
- Status and `dispatched_at` consistency is enforced by `CHECK`.
- The partial index covers both `PENDING` and `DISPATCHING`.
- Cleanup only deletes `DISPATCHED` rows.

### 22.5 Idempotency validation

- Every retryable side effect has a deterministic `job_id`.
- Every inbound external event has an `idempotency_key`.
- Every materialized external entity has a natural external identifier with a unique index.
- The three-layer idempotency model is preserved: HTTP receipt → job ID → domain natural key.
- BullMQ `jobId` deduplication is not treated as the sole idempotency mechanism for any side effect (INVARIANT-16).

### 22.6 Migration validation

- Path A and Path B are separated and are not merged (§20.0).
- Path A applies `0015`–`0018` and produces the target state.
- Path B creates the target state directly and does not apply `0015`–`0018`.
- The `0016` backfill uses the deterministic resolver from §20.2.3 step 2 and aborts on the conditions specified in §20.2.3 step 1b.
- The `0015` migration does NOT create a transitional index on `(provider, external_interaction_id)` (INVARIANT-15).
- The `0016` migration performs only the transformations listed as **Allowed** in §2.6.
- The `0016` migration writes one immutable `PRESERVATION_BASELINE_CAPTURED` row per protected table before any data modification (INVARIANT-22, §2.8.9).
- The `0016` migration compares the post-migration digest against the immutable baseline and never against a recomputed baseline (INVARIANT-19, INVARIANT-22).
- The `0016` migration writes one `PRESERVATION_EVIDENCE` row per protected table, each referencing its immutable baseline via `baseline_audit_id`, and aborts on any digest mismatch (§2.8.8, §18.13).
- The `0016` migration executes on a single dedicated session for the entire phase (INVARIANT-20) and follows the transaction/session state machine defined in §20.2.9.
- Every `0016` failure mode after Step 1 has committed leaves the deployment in the partial-0016 state described in §20.2.8.
- The partial-0016 state is recoverable by re-running `0016` (INVARIANT-21), using the existing immutable baseline and never recomputing it.
- Migration order is dependency-safe.
- Drizzle introspection matches this contract.
- Generated migrations do not introduce undocumented objects.
- Schema constraints match this document exactly.

### 22.7 Transactional boundary validation

- The webhook ingress performs exactly one database transaction per HTTP request.
- No Redis call occurs on the webhook ingress hot path.
- Every durable domain transition that produces an asynchronous side effect enqueues through `outbox_jobs`.
- No direct BullMQ enqueue occurs outside the `OutboxDispatcher`.

### 22.8 Webhook subscription health validation

- `webhook_subscription_health` is a strict 1:1 extension of `webhook_subscriptions`.
- The `webhook_subscription_health` primary key is a foreign key to `webhook_subscriptions.id` with `ON DELETE CASCADE`.
- The `webhook_subscription_health` counters are non-negative.
- The `publications.external_post_id` partial index is present with the `WHERE external_post_id IS NOT NULL` clause.
- No unique constraint is placed on `publications.external_post_id`.

### 22.9 v1.3.1 target-state validation

- `webhook_endpoints` is present with the exact columns in §5.34.
- `webhook_subscriptions.endpoint_id` is `NOT NULL` after `0018`.
- `external_interactions.provider` is `NOT NULL` after `0018`.
- The target-state AAD `META:WEBHOOK_VERIFY_TOKEN:<endpoint_id>` is authoritative.
- `provider_credentials` uses two partial unique indexes, not a `COALESCE`-based expression index.
- `webhook_subscriptions` has `CHECK (cardinality(fields) > 0)`.
- `webhook_events` lifecycle permits `DEAD_LETTER` as a distinct terminal state.
- `interaction_responses.status` has a complete `CHECK` constraint aligned with §9.3, including `CANCELLED`.
- `interaction_responses.destination_id` is `NOT NULL` with `ON DELETE RESTRICT`.
- The `external_interactions_provider_external_id_uq` object is a UNIQUE INDEX, and all references use that terminology.
- The migration advisory lock fence applies to all writers of `external_interactions`, `webhook_subscriptions`, and `webhook_endpoints` (INVARIANT-08).
- No non-unique transitional index on `(provider, external_interaction_id)` exists (INVARIANT-15).
- INVARIANT-14 (business data preservation) is asserted; the allowed/forbidden matrix in §2.6 is respected; preservation evidence exists per INVARIANT-19, §2.8, and INVARIANT-22.
- INVARIANT-16 (outbox idempotency anchor) is asserted.
- INVARIANT-17 (token rotation dual-write rule) is asserted.
- INVARIANT-18 (Bridge endpoint upsert conflict rule) is asserted.
- INVARIANT-19 (preservation evidence) is asserted.
- INVARIANT-20 (single-session advisory lock) is asserted; the §20.2.9 state machine is respected.
- INVARIANT-21 (post-failure recovery contract) is asserted.
- INVARIANT-22 (immutable pre-migration preservation baseline) is asserted; baseline rows are never modified or recomputed during recovery.

---

## 23. Architectural Invariants

The following invariants are normative for DB v1.3.1.

### 23.1 Core ingestion invariants

1. A Source is a logical publisher or brand, not a technical endpoint.
2. A Source may have multiple SourceEndpoints.
3. Endpoint state is endpoint-specific and polymorphic.
4. Endpoint state uses optimistic concurrency control.
5. A DiscoveredResource represents candidate identity, not an individual observation.
6. Multiple endpoints may observe the same DiscoveredResource.
7. Discovery observations preserve multi-path discovery history.
8. Provenance is immutable and cross-cutting.
9. Raw acquisition artifacts may have multiple snapshots per resource.
10. SourceItems are intermediate extraction artifacts.
11. ContentItems represent platform-level canonical identity.
12. Canonical URLs and alternate URLs are distinct concepts.
13. Content versions are immutable historical representations.
14. Fingerprints are independent of URL identity.
15. Duplicate relationships preserve detection evidence.
16. Stories are independent of Source identity.
17. Story membership is an explicit N:M relationship.
18. Operational endpoint health is separated from endpoint configuration.
19. PostgreSQL is authoritative for durable business and pipeline state.
20. Redis/BullMQ is authoritative only for transient execution state and queue mechanics.
21. Worker execution attempts are not canonical DB v1 entities.
22. The model remains compatible with RSS, Atom, Sitemap, HTML listing, API, and direct-seed discovery strategies.
23. Physical PostgreSQL details are derived from the logical model rather than redefining it.

### 23.2 Platform and outbox invariants

24. Every durable domain transition that produces an asynchronous side effect enqueues through `outbox_jobs` inside the same PostgreSQL transaction.
25. No direct BullMQ enqueue is permitted on a durable-write hot path.
26. The Meta webhook ingress performs exactly one database transaction per HTTP request and no Redis call on the hot path.
27. `webhook_events.raw_payload` and `webhook_events.raw_body_hash` are immutable after receipt.
28. `webhook_events.signature_verified` is always `true`; signature verification fails closed at the HTTP boundary.
29. External interactions are materialized as their own domain entity and reference content lifecycle entities only via nullable foreign keys with `ON DELETE SET NULL`.
30. Provider credentials are encrypted at rest with application-managed keys, and no plaintext secret is persisted in any ordinary application table, log, audit record, or extended cache.
31. The verify token and the provider credential use distinct encryption keys.
32. Interaction responses have their own durable lifecycle, their own moderation history, and their own reconciliation history, separate from publications.
33. The `outbox_jobs` table has no foreign keys.
34. Reconciliation is mandatory for every state machine that has an external side effect.

### 23.3 Webhook subscription health invariants

35. Webhook subscription operational health is persisted separately from webhook subscription configuration, mirroring the separation established for `source_endpoints` / `source_endpoint_health`.
36. The natural external identity of `external_interactions` is `(provider, external_interaction_id)`; see invariant 39.

### 23.4 v1.3.1 invariants

37. The App-level webhook verify token is owned by `webhook_endpoints`.
38. The target-state authoritative verify-token AAD is `META:WEBHOOK_VERIFY_TOKEN:<endpoint_id>`. The legacy destination-scoped AAD is migration-window-only.
39. The natural external identity of `external_interactions` is `(provider, external_interaction_id)`, enforced by a **UNIQUE INDEX**.
40. The v1.3.1 migration set is `0015`–`0018` with the Compatibility Bridge deployment state.
41. `webhook_events.status` permits `FAILED` (recoverable) and `DEAD_LETTER` (terminal) as distinct states.
42. `provider_credentials` uses two partial unique indexes to enforce the APP and DESTINATION uniqueness rules without a sentinel UUID.
43. `webhook_subscriptions.fields` MUST be non-empty.
44. DB v1.3.1 supports exactly one Meta App per deployment.
45. The versioned webhook token encryption key model (`WEBHOOK_TOKEN_ENCRYPTION_KEYS` + `WEBHOOK_TOKEN_ENCRYPTION_ACTIVE_VERSION`) is authoritative; the legacy single-key model is accepted only for the compatibility window.
46. The `0016 MIGRATE` phase acquires a PostgreSQL advisory lock for its entire duration (INVARIANT-08).
47. Hard Gate #1 includes plaintext equality between the legacy and the endpoint ciphertext (INVARIANT-10).
48. The provider-aware natural key is enforced by a **unique index** (`external_interactions_provider_external_id_uq`), not a UNIQUE constraint (INVARIANT-11).
49. `interaction_responses.destination_id` is `NOT NULL` with `ON DELETE RESTRICT`. A `NOT NULL` column MUST NOT be paired with `ON DELETE SET NULL`.
50. DB v1.3.1 provides multi-user access control within a shared deployment scope; tenant/account-level data isolation is out of scope (§2.5).
51. `webhook_endpoints.name` is deployment-level App identity, sourced from deployment configuration, and not derived from any subscription or destination (INVARIANT-13).
52. Path A (upgrade) and Path B (greenfield) are distinct, non-mergeable migration flows (§20.0).
53. **Business Data Preservation (INVARIANT-14).** Existing durable business data MUST be preserved byte-for-byte except for the transformations listed as **Allowed** in §2.6. Migration MUST NOT replace an existing database with a greenfield schema.
54. **No Redundant Transitional Index (INVARIANT-15).** The `0015 EXPAND` phase MUST NOT create an index that duplicates the column set of the authoritative unique index built in `0016`.
55. **Outbox Idempotency Anchor (INVARIANT-16).** The authoritative idempotency anchor for outbox-managed side effects is `outbox_jobs.job_id UNIQUE`. BullMQ `jobId` deduplication reduces, but does not eliminate, duplicate queue insertion; downstream side effects MUST be independently idempotent.
56. **Migration Fence Applies to All Writers (INVARIANT-08).** While the `0016` advisory lock is held, all application write paths to `external_interactions`, `webhook_subscriptions`, and `webhook_endpoints` MUST fail closed or participate in the migration lock protocol. PostgreSQL advisory locks are cooperative; application-level compliance is a normative requirement.
57. **Token Rotation Dual-Write Rule (INVARIANT-17).** While any legacy subscription representation is still authoritative for any reader, every verify token rotation MUST update the endpoint representation and every affected subscription representation in a single transaction. Each subscription's ciphertext MUST be produced with that subscription's own `META:WEBHOOK_VERIFY_TOKEN:<destination_id>` AAD. Partial rotation is a contract violation. `webhook_endpoints.last_rotated_at` and an `audit_logs` entry MUST be written in the same transaction. After `0018 CONTRACT` the rule reduces to the endpoint representation alone.
58. **Bridge Endpoint Upsert Conflict Rule (INVARIANT-18).** When the Compatibility Bridge or any v1.3 write path resolves the deployment's single `webhook_endpoints` row and finds that the row already exists with a decrypted plaintext differing from the incoming plaintext, the write path MUST abort the transaction and MUST NOT modify any state. Silent overwrite is a contract violation. The compare step MUST be performed under a row lock (`SELECT ... FOR UPDATE`) or an equivalent atomic operation.
59. **Preservation Evidence (INVARIANT-19).** INVARIANT-14 MUST be verified, not merely asserted. For every protected table, `0016 MIGRATE` MUST compute and record a content-level SHA-256 digest over all non-Allowed columns, both pre- and post-migration, using the canonical-JSON serialization defined in §2.8, and MUST abort if the digests differ for any protected table. The digest rows MUST be written to `audit_logs` with `action = 'PRESERVATION_EVIDENCE'` before Hard Gate #1 is declared satisfied. The `pre_digest` comparison target MUST be the immutably persisted baseline, never a recomputed baseline.
60. **Single-Session Advisory-Lock Requirement (INVARIANT-20).** The `0016 MIGRATE` phase MUST execute on a single dedicated PostgreSQL session for its entire duration, including the non-transactional `CREATE UNIQUE INDEX CONCURRENTLY` step and the post-build catalog validation. Connection-pooled implementations MUST pin a single physical connection for the phase. Transaction boundaries do not release the session-level advisory lock. The transaction/session state machine is defined in §20.2.9.
61. **Post-Failure Recovery Contract (INVARIANT-21).** A failure of `0016` after Step 1 has committed data does NOT return the deployment to the `0015` + Bridge state. The deployment enters the partial-0016 state (§20.2.8), which is recoverable by re-running `0016`. Manual `UPDATE` or `DELETE` statements against protected tables as a recovery mechanism are a contract violation. `0018 CONTRACT` MUST NOT execute while the deployment is in the partial-0016 state.
62. **Immutable Pre-Migration Preservation Baseline (INVARIANT-22).** The pre-migration preservation digest set MUST be computed and immutably persisted by the migration runner before the first `0016` data modification, using the reserved `PRESERVATION_BASELINE_CAPTURED` action. Once committed, the baseline rows MUST NOT be modified, deleted, or superseded. Recovery attempts MUST use the existing baseline as the sole comparison target and MUST NOT recompute a new baseline from the current state. If the baseline is missing or partial and any `0016` data modification has been committed, the recovery attempt MUST abort with a hard failure.

---

## 24. Deferred Decisions

### D-001 — Authentication session/token persistence

`users` and `roles` are persisted, but session, refresh-token, credential-rotation, and external-identity persistence are not defined here.

**Status: DEFERRED — NON-BLOCKING**

### D-002 — Image status vocabulary

`images.status` remains domain-validated text.

**Status: DEFERRED — NON-BLOCKING**

### D-003 — Image rights taxonomy

`image_rights.rights_status` remains domain-validated text.

**Status: DEFERRED — NON-BLOCKING**

### D-004 — Entity taxonomy

`content_entities.entity_type` remains text.

**Status: DEFERRED — NON-BLOCKING**

### D-005 — Category taxonomy

`content_categories.category` remains text.

**Status: DEFERRED — NON-BLOCKING**

### D-006 — AI cost currency/unit

`ai_usage.estimated_cost` persists a numeric value, but the authoritative currency or accounting unit is defined outside this database contract.

**Status: DEFERRED — NON-BLOCKING**

### D-007 — Persistent endpoint execution history

A future `EndpointRun` or equivalent may be introduced if persistent operational analytics become necessary. Such an entity must not duplicate Redis/BullMQ execution state.

**Status: DEFERRED — NON-BLOCKING**

### D-008 — Interaction threading

The `external_interactions.parent_external_id` column is present in DB v1 and is sufficient to record parent-child relationships between interactions. A full thread model (`conversation_threads`, `depth`, `reply_count`, thread-root materialization) is **not** required in DB v1.

A dedicated thread model becomes justified only when at least one of the following holds:

- the admin UI requires a tree-structured thread view;
- analytics measures thread depth, reply distribution, or engagement cascade;
- the automatic response policy requires thread context to make a decision.

Until then, the data required to reconstruct a thread is preserved via `parent_external_id` and `permalink`. Only the model is deferred, not the information.

**Status: DEFERRED — NON-BLOCKING (data preserved; model deferred)**

### D-009 — Webhook subscription health

The `webhook_subscription_health` table (§5.36) is part of DB v1.3.1. It provides durable operational health storage for webhook subscriptions, mirroring the `source_endpoint_health` pattern.

The **storage** is resolved.

The **use** of this data — alerting thresholds, auto-pause on consecutive failures, health dashboards, decay-weighted reputation — is deferred.

**Status: RESOLVED (storage) — USE DEFERRED — NON-BLOCKING**

### D-010 — Response template storage

DB v1 stores interaction response templates in `system_config` under the key `interaction_response_templates`. A dedicated `interaction_response_templates` table may be introduced if template count, versioning, or access control requirements grow beyond what `system_config` and `config_audit_log` provide.

**Status: DEFERRED — NON-BLOCKING**

### D-011 — Response rule storage

Interaction response policy rules are stored in `system_config` under the key `interaction_response_rules`. A dedicated table may be introduced if rule complexity justifies it.

**Status: DEFERRED — NON-BLOCKING**

### D-012 — AI-assisted response generation

DB v1 interaction responses are template-based and deterministic. AI-assisted response text generation is a post-MVP feature and is not represented in the schema.

**Status: DEFERRED — NON-BLOCKING**

### D-013 — Multi-provider vs multi-page webhook scope

Two distinct concerns are separated:

**Multi-page (within Meta).** Resolved in v1.3.1. The `webhook_endpoints` table owns the App-level `verify_token`. Multiple Pages under one App are modelled as multiple `webhook_subscriptions` rows referencing the same endpoint.

**Multi-App (more than one Meta App per deployment).** Deferred beyond v1.3.1. DB v1.3.1 supports exactly one Meta App per deployment (INVARIANT-12). Multi-App support requires an `endpoint_key` or equivalent deterministic selector and will be introduced in a future revision.

**Multi-provider (beyond Meta).** Deferred beyond v1.3.1. The schema is provider-aware where practical (`webhook_subscriptions.provider`, `webhook_events.provider`, `provider_credentials.provider`, `external_interactions.provider`), but the extraction logic, response policy, and credential validation are Meta-specific.

**Status: PARTIALLY RESOLVED (single-App, multi-page) — MULTI-APP AND MULTI-PROVIDER DEFERRED — NON-BLOCKING**

### D-014 — Outbox payload schema versioning

`outbox_jobs.payload` is untyped `jsonb`. A future versioned payload envelope may be introduced if cross-version dispatch compatibility becomes necessary during rolling deployments.

**Status: DEFERRED — NON-BLOCKING**

### D-015 — Credential rotation history

`provider_credentials` tracks only the latest value and `last_rotation_at`. Historical credential values are not retained. A future `provider_credential_history` table may be introduced if forensic requirements justify it.

**Status: DEFERRED — NON-BLOCKING**

### D-016 — Provider-aware natural key for `external_interactions`

**Resolved in v1.3.1.** The composite `(interaction_type, external_interaction_id)` is replaced by `(provider, external_interaction_id)`. The authoritative enforcement object is a **UNIQUE INDEX** named `external_interactions_provider_external_id_uq` (INVARIANT-11). It is not a PostgreSQL `UNIQUE CONSTRAINT`.

A narrower constraint (`UNIQUE (external_interaction_id)`) is explicitly rejected because it would:

- assume a Meta-specific global uniqueness guarantee that may not hold for future providers;
- create an asymmetry with the rest of the schema's provider-aware pattern.

The v1.3.1 approach directly matches the long-term natural key.

**Status: RESOLVED**

### D-017 — Reciprocal uniqueness for `duplicate_matches`

Reciprocal uniqueness of `duplicate_matches` remains an **application-level** invariant, documented in the service layer, because a `CHECK (canonical_item_id < duplicate_item_id)` would prevent recording the detection direction. Detection direction is meaningful evidence.

**Status: RESOLVED (application-enforced)**

### D-018 — Interaction `occurred_at` monotonic contract

For a given `(provider, external_interaction_id)`, the `occurred_at` value stored in the `external_interactions` row MUST NOT decrease across accepted mutations. An accepted mutation is any `INSERT ... ON CONFLICT` or `UPDATE` that commits successfully. The enforcement mechanism is the upsert predicate defined in §5.39:

```sql
WHERE external_interactions.occurred_at <= EXCLUDED.occurred_at
```

An incoming row whose `occurred_at` is strictly earlier than the currently persisted value for the same `(provider, external_interaction_id)` MUST NOT be applied; the persisted row MUST remain unchanged. Concurrent inserts serialize on the unique index via PostgreSQL's `ON CONFLICT` mechanism.

This is the precise form of the "monotonic" contract. It does not assert that a broader set of mutations can never move `occurred_at` backward — only that the upsert path, which is the sole intended write path for interaction rows, enforces the non-decreasing predicate.

**Status: RESOLVED (explicit predicate; precise monotonicity definition)**

### D-019 — Multi-tenant isolation

DB v1.3.1 does not provide tenant-, account-, workspace-, or organization-level data isolation. Multi-user access control is within a shared deployment scope (§2.5). A multi-tenant model would require a first-class architectural revision with its own contract.

**Status: DEFERRED — NON-BLOCKING**

---

## 25. Implementation Boundary

The implementation sequence is:

```text
DB v1 Logical Model Specification v1.0
                ↓
DATABASE_SCHEMA_CONTRACT.md v1.3.1
                ↓
Drizzle schema (45 tables)
                ↓
Schema index / exports
                ↓
Generate migrations (Path A or Path B — see §20.0)
                ↓
Validate migrations
                ↓
Implement repositories
                ↓
Implement transaction manager
```

The Drizzle implementation must not invent fields, tables, relationships, or indexes that are absent from this contract without first revising the contract.

Likewise, the database contract must not silently introduce domain concepts merely because they are convenient to implement in Drizzle.

**Conformance is not derived from the existence of code.** No repository, migration file, or application module that predates this contract is to be interpreted as conformant. Conformance is established only by explicit verification against §22.

### 25.1 Recommended implementation order

```text
1. outbox-repository        (platform backbone — everything else depends on it)
2. webhook-events-repository
3. webhook-endpoints-repository
4. webhook-subscriptions-repository
5. webhook-deliveries-repository
6. external-interactions-repository
7. provider-credentials-repository
8. interaction-response-repository
9. interaction-moderation-repository
10. transaction-manager (enqueueWithTx)
```

The `TransactionManager.enqueueWithTx` API is the single point at which the outbox pattern becomes concrete:

```typescript
await txManager.run(async (tx) => {
  const event = await webhookEventsRepo.insert(tx, eventData);
  if (event) {
    await outboxRepo.enqueue(tx, {
      queueName: 'webhook.process',
      jobId: `webhook.process:${event.id}`,
      payload: { webhookEventId: event.id },
      traceId: event.traceId,
    });
  }
});
```

This three-line pattern is the essence of the outbox. Every other concern is infrastructure around it.

### 25.2 Repository-level obligations

The following repository-level obligations are normative for any implementation that claims conformance to this contract:

| Repository                         | Obligation                                                                                                                                              | Invariant             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `webhook-endpoints-repository`     | Endpoint upsert path MUST compare existing decrypted plaintext and abort on mismatch.                                                                   | INVARIANT-18          |
| `webhook-endpoints-repository`     | Token rotation MUST write the endpoint and every affected subscription in one transaction with per-row AADs.                                            | INVARIANT-17          |
| `webhook-subscriptions-repository` | Every write to `webhook_endpoints`-owned token state MUST be performed through the endpoint repository; direct writes are prohibited.                   | INVARIANT-17          |
| `external-interactions-repository` | Every write path MUST be wrapped by the migration advisory-lock aware guard during the migration window.                                                | INVARIANT-08          |
| `provider-credentials-repository`  | Upsert MUST target the two partial unique indexes; no `COALESCE` sentinel-based identity may be used.                                                   | §5.40, §8.3           |
| `outbox-repository`                | `job_id` uniqueness MUST be enforced by the database; no in-application deduplication may substitute for it.                                            | INVARIANT-16          |
| `transaction-manager`              | `enqueueWithTx` MUST be the sole outbox enqueue path for outbox-managed side effects on the durable-write hot path.                                     | §12                   |
| migration runner                   | `0016 MIGRATE` MUST execute on a single dedicated session (INVARIANT-20) and MUST follow the transaction/session state machine (§20.2.9).               | INVARIANT-20, §20.2.9 |
| migration runner                   | `0016 MIGRATE` MUST write the immutable `PRESERVATION_BASELINE_CAPTURED` set before any data modification, and MUST never recompute it during recovery. | INVARIANT-22, §2.8.9  |
| migration runner                   | `0016 MIGRATE` MUST implement the partial-0016 recovery contract, including the Step 3a baseline presence check.                                        | INVARIANT-21, §20.2.8 |

These obligations must be verifiable by static analysis or code review. Any code path that writes to a protected table without satisfying its listed obligation is a contract violation.

---

## 26. Contract Status

**FINAL — PRODUCTION-READY DB v1.3.1 BASELINE WITH META INTEGRATION**

**Migration semantics: Zero-Downtime Schema Migration + Bounded Write Fence**

This document is the normative physical persistence baseline for implementation. It is self-contained and does not require the reader to consult any prior version of `DATABASE_SCHEMA_CONTRACT.md`.

The complete DB v1.3.1 persistence table count is **45 tables**, organized into seven categories:

```text
15  core logical model
18  supporting platform persistence
 4  inbound event persistence
 1  inbound health companion
 1  webhook endpoint aggregate
 5  provider credentials + response
 1  platform pattern (outbox)
```

The source-ingestion persistence model is finalized around:

```text
Source
  ↓
SourceEndpoint
  ↓
DiscoveryObservation
  ↓
DiscoveredResource
  ↓
RawResource
  ↓
SourceItem
  ↓
ContentItem
```

with:

```text
SourceEndpoint → SourceEndpointHealth
ContentItem → ContentUrls
ContentItem → ContentVersions
ContentItem → ContentFingerprints
ContentItem ↔ DuplicateMatches
ContentItem ↔ StoryMembers ↔ Story
WebhookEndpoint → WebhookSubscription → WebhookSubscriptionHealth
```

and cross-cutting provenance through:

```text
ProvenanceEvent
```

The old source-level persistence structures:

```text
source_cursors
source_health
```

are removed from DB v1.

The DB v1.3.1 worker boundary is explicitly:

```text
Redis/BullMQ
  → transient execution state
  → queue scheduling
  → retries
  → worker diagnostics

PostgreSQL
  → durable pipeline state
  → canonical artifacts
  → provenance
  → endpoint health
  → webhook subscription health
  → business history
  → audit history
  → outbox intent

OutboxDispatcher
  → bridges PostgreSQL intent to Redis execution
  → never authoritative for domain state
  → recoverable at every stage
```

The v1.3.1 architectural commitment is expressed by the following invariants:

```text
App-level webhook configuration is owned by webhook_endpoints.
The target-state authoritative verify-token AAD is
  META:WEBHOOK_VERIFY_TOKEN:<endpoint_id>.
Token rotation dual-writes the endpoint representation and every affected
  subscription representation in a single transaction (INVARIANT-17).
Bridge endpoint upsert aborts on plaintext mismatch; silent overwrite is
  a contract violation (INVARIANT-18).
The natural external identity of external_interactions is
  (provider, external_interaction_id), enforced by a UNIQUE INDEX.
webhook_events.status distinguishes FAILED (recoverable) from DEAD_LETTER (terminal).
provider_credentials uses partial unique indexes; no sentinel UUID.
webhook_subscriptions.fields is non-empty.
interaction_responses.destination_id is NOT NULL with ON DELETE RESTRICT.
One Meta App per deployment.
Encryption keys are versioned; the legacy single-key model is compatibility-only.
Path A (upgrade) and Path B (greenfield) are distinct, non-mergeable migration flows.
The 0016 migration fence applies to ALL writers of external_interactions,
  webhook_subscriptions, and webhook_endpoints (INVARIANT-08).
Historical durable business data is preserved byte-for-byte except for the
  transformations explicitly allowed in §2.6 (INVARIANT-14), and this is
  verified via content-level SHA-256 evidence per §2.8 (INVARIANT-19).
  Verification uses an IMMUTABLE pre-migration baseline captured before
  any data modification (INVARIANT-22, §2.8.9, §20.2.3 step 1).
No redundant transitional index duplicates the D-016 unique index (INVARIANT-15).
The authoritative outbox idempotency anchor is outbox_jobs.job_id UNIQUE;
  BullMQ jobId deduplication is a mitigation, not a guarantee (INVARIANT-16).
The 0016 migration executes on a single dedicated session (INVARIANT-20),
  following the transaction/session state machine in §20.2.9.
A 0016 failure after Step 1 leaves the deployment in the partial-0016 state,
  which is recoverable by re-running 0016 using the EXISTING immutable
  baseline, never a recomputed one (INVARIANT-21, INVARIANT-22, §20.2.8).
Multi-user access control within a shared deployment scope; no tenant isolation.
```

The migration protocol is characterized as **zero-downtime schema migration + bounded write fence**, not as unrestricted zero-downtime runtime:

```text
Schema changes              → never require taking the database offline
Application write paths     → a bounded subset is deliberately fenced
                              during 0016 (INVARIANT-08)
Duration of the fence       → bounded by the 0016 phase and Hard Gate #1
```

Whenever the phrase "zero-downtime" appears in isolation in this document, an operator runbook derived from it, or a higher-level document citing this contract, it MUST be read as **"zero-downtime schema migration + bounded write fence"** unless the surrounding text explicitly states otherwise.

No production Drizzle schema or migration should diverge from this contract without a corresponding architecture-level revision.

**Implementation gate:** before changing the database structure, update the higher-level domain and logical contracts, then this document, and only then the Drizzle schema or migrations.

**End of DATABASE_SCHEMA_CONTRACT.md v1.3.1**
