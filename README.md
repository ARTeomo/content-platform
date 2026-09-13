# Content Platform

A content automation platform: discovery, analysis, moderation, scheduling,
and publishing of curated content to external destinations.

## Status

**Pre-implementation.** The architecture, logical model, and database schema
contract are frozen. The Drizzle schema implementation is in progress.

## Documentation

| Document | Purpose |
|---|---|
| `TECHNICAL_SPECIFICATION.md` | System architecture and behavior |
| `LOGICAL_MODEL_SPECIFICATION.md` | DB v1 logical model |
| `DATABASE_SCHEMA_CONTRACT.md` | Physical PostgreSQL persistence contract |
| `docs/adr/` | Architecture Decision Records |
| `docs/conventions/` | Development conventions |

## Repository structure

```text
content-platform/
├── apps/
│   ├── api/            HTTP API and webhook ingress
│   ├── worker/         Background workers and OutboxDispatcher
│   └── admin/          Administrative UI
├── packages/
│   └── database/       Drizzle schema, migrations, repositories
├── docs/
│   ├── adr/            Architecture Decision Records
│   └── conventions/    Development conventions
├── scaffold/           Repository bootstrap scripts
└── .github/            GitHub configuration and templates
