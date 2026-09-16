# ADR-002 — Unified transactional outbox

- **Status:** Accepted
- **Date:** 2026-09-15
- **Deciders:** Platform architecture
- **Context:** How to enqueue asynchronous work without split-brain
  between PostgreSQL and Redis.

## Context

The platform commits durable domain state to PostgreSQL and executes
asynchronous work through Redis/BullMQ. Both are independent systems:
there is no transactional coordinator that spans both.

A naive approach enqueues to BullMQ inside the same code path that
commits to PostgreSQL:

```text
BEGIN
  <domain insert>
  BullMQ.add(queue, payload)   <- NOT transactional
COMMIT
```

This produces two failure modes:

- **Commit succeeds, Redis add fails** -> orphaned event in the
  database, never processed.
- **Commit fails, Redis add succeeds** -> orphaned job in the queue,
  worker crashes on load.

Both violate the platform's fail-closed invariant.

## Decision

Use a **transactional outbox** with a single `outbox_jobs` table.

Every durable domain transition that must produce an asynchronous
side effect writes an `outbox_jobs` row **inside the same PostgreSQL
transaction** that commits the domain state:

```text
BEGIN
  <domain state mutation>
  INSERT INTO outbox_jobs (queue_name, job_id, payload, trace_id)
COMMIT
```

A separate in-process component, the `OutboxDispatcher`, polls
`PENDING` rows and dispatches them to BullMQ. No direct BullMQ
enqueue is permitted on a durable-write hot path.

### Key invariants

1. `outbox_jobs.payload` contains **identifiers only** — never a full
   document, never a raw payload, never a secret.
2. `outbox_jobs.job_id` is deterministic and idempotent. Enqueuing the
   same logical event twice produces the same `job_id`.
3. `outbox_jobs` has **no foreign keys**. It is a platform primitive,
   not a domain entity.

### Claim semantics

The dispatcher claims work with `FOR UPDATE SKIP LOCKED`:

```sql
WITH claimed AS (
  SELECT id FROM outbox_jobs
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
RETURNING id
```

This allows multiple dispatcher instances to operate concurrently
without coordination.

### Recovery

After claiming, the dispatcher calls BullMQ and marks the row
`DISPATCHED`. If it crashes between the two, the row remains
`DISPATCHING`. Recovery restores it to `PENDING` after
`OUTBOX_DISPATCH_STALE_THRESHOLD_SECONDS`. Re-dispatch is safe because
BullMQ's `jobId` option deduplicates the re-enqueue — the same
`job_id` produces no duplicate job.

### Cleanup

A dedicated `system.outbox.cleanup` job deletes `DISPATCHED` rows
older than `OUTBOX_CLEANUP_RETENTION_DAYS`. `PENDING`, `DISPATCHING`,
and `FAILED` rows are never deleted by cleanup.

## Consequences

### Positive

- **No split-brain.** The enqueue intent is durable in the same
  system that owns the domain state. If Redis is lost, no business
  state is lost.
- **Recoverable at every stage.** The `system.rebuild` service can
  reconstruct every pending enqueue from PostgreSQL alone.
- **At-least-once dispatch + idempotent consumer.** A crash at any
  point produces a retryable row, not a lost event.
- **Uniform across the platform.** Webhook ingress, publication
  scheduling, credential refresh, and interaction response all use
  the same primitive.

### Negative

- **Additional table.** The `outbox_jobs` table adds storage and
  index overhead. Mitigated by time-based cleanup.
- **Slightly higher latency.** The dispatcher polls on an interval
  (default 2 s when idle), so jobs are not enqueued in the same
  millisecond as the commit. This is acceptable for the platform's
  workload.
- **Requires a running dispatcher.** If the dispatcher is stopped,
  jobs accumulate in `PENDING`. Recovery restores them when it
  restarts.

### Neutral

- The outbox does not eliminate the need for reconciliation. It
  eliminates a specific class of split-brain failure, not all
  eventual-consistency concerns.

## Alternatives considered

- **Direct BullMQ enqueue inside the transaction.** Rejected — the
  two systems are not transactional.
- **XA / two-phase commit.** Rejected — not supported by BullMQ or
  Redis, and unnecessary complexity for the target workload.
- **Redis as authoritative state with PostgreSQL as a mirror.**
  Rejected — the platform's first principle is that PostgreSQL is
  the system of record.
- **Domain-status-as-outbox** (query every domain table for pending
  work). Rejected — produces N domain-specific dispatchers and N
  rebuild queries, versus one unified primitive.

## References

- `packages/database/src/schema/platform/outbox-jobs.ts`
- `packages/database/src/repositories/outbox-repository.ts`
- `apps/worker/src/outbox-dispatcher.ts`
- `DATABASE_SCHEMA_CONTRACT.md` §5.43, §12
