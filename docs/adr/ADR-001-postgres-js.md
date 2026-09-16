# ADR-001 — `postgres.js` as the PostgreSQL driver

- **Status:** Accepted
- **Date:** 2026-09-15
- **Deciders:** Platform architecture
- **Context:** PostgreSQL driver selection for the database package.

## Context

The platform requires a PostgreSQL driver that:

- is compatible with Drizzle ORM's PostgreSQL dialect;
- supports prepared statements and connection pooling;
- works with the Neon connection model;
- provides TypeScript-first type safety.

Two drivers are commonly used with Drizzle:

1. `pg` (node-postgres) — the oldest, most widely deployed.
2. `postgres` (postgres.js) — a modern, TypeScript-first alternative.

## Decision

Use **`postgres` (postgres.js)** as the PostgreSQL driver, wired
through `drizzle-orm/postgres-js`.

The driver is instantiated by `createDatabaseClient` in
`packages/database/src/client.ts`.

## Consequences

### Positive

- **TypeScript-first.** Built-in TypeScript support, no `@types/*`
  shim needed for the driver itself.
- **Native prepared statements.** The `prepare: true` option
  (default) enables named prepared statements at the wire level,
  reducing planning overhead on repeated queries.
- **Single import.** The tagged-template API (`` sql`SELECT 1` ``) is
  available directly, which the codebase uses for health checks and
  raw SQL in repositories.
- **Modern pooling.** Built-in pool with configurable `max`,
  `idle_timeout`, `connect_timeout`.
- **Neon-compatible.** Verified against Neon's serverless PostgreSQL
  over TLS without additional configuration.

### Negative

- **Prepared statements cannot be used with PgBouncer in
  transaction mode.** The connection option `prepare` must be set to
  `false` when the connection passes through PgBouncer. This is
  documented in the `DatabaseConfig` type.
- **Smaller ecosystem than `pg`.** Some third-party tooling assumes
  `pg` specifically. This has not been a blocker.

### Neutral

- Both drivers expose roughly equivalent performance for the target
  workload (hundreds to low thousands of writes per day).

## Alternatives considered

- **`pg` (node-postgres).** Rejected because it requires
  `@types/pg`, has a callback-first API that is awkward with
  async/await, and does not provide the tagged-template ergonomics
  that the repository layer uses heavily.
- **Raw `node-postgres` with a custom query builder.** Rejected
  because Drizzle already provides the type safety and query
  ergonomics, and mixing two query systems adds complexity.

## References

- `packages/database/src/client.ts`
- `docs/conventions/database-schema.md`
- https://github.com/porsager/postgres
