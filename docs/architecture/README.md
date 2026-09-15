# Architecture

This directory contains system- and domain-level documentation for the
Content Platform. It is the reference point between the high-level
[`TECHNICAL_SPECIFICATION.md`](../../TECHNICAL_SPECIFICATION.md) and the
concrete persistence model in
[`DATABASE_SCHEMA_CONTRACT.md`](../../DATABASE_SCHEMA_CONTRACT.md).

---

## Documents

| Document                                     | Purpose                                                             |
| -------------------------------------------- | ------------------------------------------------------------------- |
| [`system-overview.md`](./system-overview.md) | The system at a glance: pipeline, principles, external integrations |
| [`domain-model.md`](./domain-model.md)       | Domain entities, boundaries, and lifecycle                          |
| [`data-model.md`](./data-model.md)           | The 44-table persistence model summarized by category               |
| [`module-map.md`](./module-map.md)           | Package layout, dependency rules, and boundary enforcement          |

---

## Architectural principles

The platform is designed around five principles:

1. **PostgreSQL is the authoritative system of record.**
   Every durable business decision is committed to PostgreSQL before any
   side effect is attempted.

2. **Redis/BullMQ is the asynchronous execution layer.**
   Redis is never authoritative for business state. If Redis is lost, the
   queue system is reconstructed from PostgreSQL.

3. **Every important state transition is explicit and auditable.**
   State machines are modeled as first-class columns with `CHECK`
   constraints. Every transition produces an audit record.

4. **Uncertain external outcomes are reconciled, not blindly retried.**
   An `UNKNOWN` external outcome is a distinct state. Reconciliation is
   mandatory for every state machine that has an external side effect.

5. **The system fails closed when mandatory validation cannot be completed.**
   Missing information is `REVIEW`, not `PUBLISH`. Signature
   verification failures are rejected at the HTTP boundary.

---

## Architectural invariants

The following invariants are normative. They are restated across the
specification documents and enforced at the persistence layer where
possible.

### Ingestion

- A `Source` is a logical publisher or brand, not a technical endpoint.
- A `Source` may have multiple `SourceEndpoints`.
- Endpoint state is endpoint-specific and polymorphic.
- Endpoint state uses optimistic concurrency control (`state_version`).
- A `DiscoveredResource` represents candidate identity, not an individual
  observation.
- Multiple endpoints may observe the same `DiscoveredResource`.
- Provenance is immutable and cross-cutting.

### Content

- Canonical URLs and alternate URLs are distinct concepts.
- Content versions are immutable historical representations.
- Fingerprints are independent of URL identity.
- Duplicate relationships preserve detection evidence.
- Stories are independent of Source identity.
- Story membership is an explicit N:M relationship.

### Platform

- Operational endpoint health is separated from endpoint configuration.
- Provider credentials are encrypted at rest with application-managed keys.
- No plaintext secret is persisted in any ordinary application table.
- Every durable domain transition that produces an asynchronous side
  effect enqueues through `outbox_jobs` inside the same PostgreSQL
  transaction.
- No direct BullMQ enqueue is permitted on a durable-write hot path.

### Persistence boundary

- `outbox_jobs` has no foreign keys. It is a platform primitive.
- `audit_logs` has no polymorphic foreign key on `entity_id`.
- `provenance_events` has no polymorphic foreign key on
  `target_entity_id`.
- Worker execution attempts are not canonical PostgreSQL entities.
  Transient queue state belongs to Redis/BullMQ.

---

## Architectural decision records

The rationale for specific decisions lives in
[`../adr/`](../adr/). The most relevant ADRs for architecture readers:

| ADR                                              | Decision                                               |
| ------------------------------------------------ | ------------------------------------------------------ |
| [`ADR-001`](../adr/ADR-001-postgres-js.md)       | `postgres.js` as the PostgreSQL driver                 |
| [`ADR-002`](../adr/ADR-002-outbox-pattern.md)    | Unified transactional outbox                           |
| [`ADR-003`](../adr/ADR-003-uuid-primary-keys.md) | UUID primary keys with `gen_random_uuid()`             |
| [`ADR-004`](../adr/ADR-004-no-db-triggers.md)    | Application-managed `updated_at`; no database triggers |
| [`ADR-005`](../adr/ADR-005-health-separation.md) | Operational health separated from configuration        |

---

## Roadmap

| Phase        | Scope                                         | Status      |
| ------------ | --------------------------------------------- | ----------- |
| Phase 1 – 13 | Drizzle schema (44 tables)                    | ✅ Complete |
| Phase 14     | Local dev environment + integration tests     | ⏳ Next     |
| Phase 15     | Credential lifecycle                          | ⏳          |
| Phase 16     | Outbox dispatcher + `webhook.process` worker  | ⏳          |
| Phase 17     | Webhook ingress                               | ⏳          |
| Phase 18     | Interaction response lifecycle                | ⏳          |
| Phase 19     | Meta publisher adapter and reconciliation     | ⏳          |
| v1.3         | `webhook_endpoints`, multi-page Meta support  | 📅 Planned  |
| v1.4+        | Analytics read models, AI response generation | 📅 Planned  |
