# ADR-005 — Operational health is separated from configuration

- **Status:** Accepted
- **Date:** 2026-09-15
- **Deciders:** Platform architecture
- **Context:** Where to store high-frequency operational metrics.

## Context

Several entities have both **relatively stable configuration** and
**high-frequency operational state**:

| Entity                  | Configuration                     | Operational                      |
| ----------------------- | --------------------------------- | -------------------------------- |
| `source_endpoints`      | url, representation, capabilities | consecutive failures, last error |
| `webhook_subscriptions` | verify token, subscribed fields   | delivery counters, last success  |

Storing both in the same row produces:

- **Write amplification.** Every health update rewrites the entire row,
  including the stable configuration.
- **Lock contention.** High-frequency health updates compete with
  configuration changes.
- **Audit confusion.** The `updated_at` timestamp is dominated by
  health updates, obscuring real configuration changes.

## Decision

Operational health is stored in a **separate 1:1 extension table** for
each entity that needs it.

| Entity               | Configuration table     | Health table                  |
| -------------------- | ----------------------- | ----------------------------- |
| Source endpoint      | `source_endpoints`      | `source_endpoint_health`      |
| Webhook subscription | `webhook_subscriptions` | `webhook_subscription_health` |

The health table shares the configuration table's primary key as a
foreign key. The row is created automatically with the configuration
row and cascade-deleted with it.

### What belongs in the health table

- Counters that increment on every event: `consecutive_failures`,
  `consecutive_successes`, `events_today`.
- Last-event timestamps: `last_success_at`, `last_failure_at`.
- Last error summary: `last_error_category`, `last_error_message`.

### What belongs in the configuration table

- Lifecycle state of the configuration itself: `status`,
  `last_verified_at`, `last_rotated_at`.
- Fields that a developer or admin would change deliberately.

## Consequences

### Positive

- **Stable configuration is not rewritten on every event.** The
  high-frequency `UPDATE` targets a small table with a narrow row.
- **Clear audit trail.** A change to the configuration table means a
  deliberate configuration change. Health fluctuations do not pollute
  the configuration's `updated_at`.
- **Symmetry across the platform.** `source_endpoint_health` and
  `webhook_subscription_health` follow the same pattern, so a reader
  who understands one understands the other.
- **Health history is preserved independently.** A health record can
  outlive a temporary configuration change (e.g. a `DISABLED`
  subscription keeps its failure history).

### Negative

- **An additional table per entity type.** A reader must join to see
  the full picture. Mitigated by repository methods that join when
  needed (`findWithHealth`).
- **Requires transaction discipline.** Creating a subscription must
  also create its health row. The repository enforces this in a single
  transaction (`WebhookSubscriptionsRepository.create`).

### Neutral

- The separation is orthogonal to retention. Health tables can have
  their own retention policy without affecting configuration.

## Scope: storage now, use later

For `webhook_subscription_health`, the platform stores health
metrics from day one but does not yet consume them. Alerting,
auto-pause, and dashboards are deferred (see DATABASE_SCHEMA_CONTRACT
D-009). Storing now avoids a schema migration when consumption is
added.

## Alternatives considered

- **Single table with a wide row.** Rejected — write amplification and
  audit confusion.
- **Store health in `system_logs`.** Rejected — logs are append-only
  history; the health table is a current-state snapshot. Querying logs
  for "current consecutive failure count" is not the right tool.
- **Store health in Redis.** Rejected — Redis is not authoritative for
  business state, and health is business state.
- **Two separate tables, one per concern, joined at query time.**
  Rejected — same as this decision, but the health table's PK-as-FK
  makes the 1:1 relationship explicit at the schema level.

## References

- `packages/database/src/schema/ingestion/source-endpoint-health.ts`
- `packages/database/src/schema/webhook/webhook-subscription-health.ts`
- `DATABASE_SCHEMA_CONTRACT.md` §5.5, §5.44
- `docs/architecture/README.md` — architectural invariants
