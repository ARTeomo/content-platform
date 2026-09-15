# Content Platform

> A domain-oriented, event-driven content discovery, analysis, moderation,
> scheduling, and publishing platform.

[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D12-F69220?logo=pnpm&logoColor=white)](https://pnpm.io)
[![TypeScript](https://img.shields.io/badge/typescript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-Proprietary-red)](#license)

---

## Overview

The Content Platform continuously discovers content from configured
sources, normalizes and classifies it, determines relevance, extracts
domain entities, identifies duplicates and related stories, evaluates
source reputation, optionally enriches content through an AI provider,
validates the resulting publication package, applies image and
attribution policies, routes content through configurable moderation,
schedules approved material, publishes it through authorized external
APIs, and reconciles the outcome of uncertain external operations.

Facebook / Meta is treated as a **publisher adapter** and an
**inbound webhook provider**, not as the foundation of the application.

The platform is designed around five principles:

1. **PostgreSQL is the authoritative system of record.**
2. **Redis/BullMQ is the asynchronous execution layer.**
3. **Every important state transition is explicit and auditable.**
4. **Uncertain external outcomes are reconciled, not blindly retried.**
5. **The system fails closed when mandatory validation cannot be completed.**

---

## Key capabilities

| Capability               | Description                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| **Discovery**            | Endpoint-oriented ingestion (RSS, Atom, JSON Feed, sitemap, HTML listing, API, direct seed).  |
| **Normalization**        | Deterministic canonicalization of source items into canonical content items.                  |
| **Intelligence**         | Relevance scoring, category assignment, entity extraction, exact and fuzzy deduplication.     |
| **Story clustering**     | Grouping of related content items into a single underlying story.                             |
| **Conflict resolution**  | Selection of the preferred source, article, image, and entity representation.                 |
| **Content processing**   | Optional AI-driven summarization and translation, with strict quota enforcement.              |
| **Validation**           | Mandatory publication-package validation (URL, length, Unicode, attribution, rights).         |
| **Moderation**           | Human moderation with bulk actions, versioning, and full audit trail.                         |
| **Scheduling**           | Timezone-aware scheduling with publication windows and daily limits.                          |
| **Publishing**           | Isolated publisher adapter (Meta Page). Publication locking, idempotency, reconciliation.     |
| **Webhook ingress**      | Meta webhook signature verification, idempotent persistence, materialization of interactions. |
| **Interaction response** | Outbound responses to inbound comments and mentions, with moderation and reconciliation.      |
| **Credential lifecycle** | Encrypted-at-rest Meta credentials with rotation, health states, and publishing pause.        |
| **Observability**        | Structured logs, metrics, trace IDs, health endpoints, audit trail.                           |

---

## Architecture at a glance

```text
                        EXTERNAL SOURCES                META PLATFORM
                              │                              │
                              ▼                              │
                    ┌──────────────────┐                     │
                    │  Source Poller   │                     │
                    └────────┬─────────┘                     │
                             │                               │
                    ┌────────▼─────────┐                     │
                    │  Normalization   │                     │
                    │  Relevance       │                     │
                    │  Entities        │                     │
                    │  Deduplication   │                     │
                    │  Clustering      │                     │
                    └────────┬─────────┘                     │
                             │                               │
                    ┌────────▼─────────┐       ┌─────────────▼──────────┐
                    │  Content         │       │  Webhook Ingress       │
                    │  Processing      │       │  (signature, idempot.) │
                    │  Validation      │       └─────────────┬──────────┘
                    │  Moderation      │                     │
                    │  Scheduling      │                     ▼
                    └────────┬─────────┘       ┌─────────────────────────┐
                             │                 │  Webhook Processing     │
                             ▼                 │  Interaction Response   │
                    ┌──────────────────┐       └─────────────┬───────────┘
                    │  Publisher       │                     │
                    │  Adapter         │◄────────────────────┘
                    │  (Meta)          │       (push reconciliation)
                    └────────┬─────────┘
                             │
                             ▼
                       EXTERNAL POST

        ═══════════════════════════════════════════════
                       Platform backbone
        ┌──────────────────────────────────────────────┐
        │  PostgreSQL  —  system of record             │
        │  outbox_jobs —  transactional outbox         │
        │  Redis/BullMQ — asynchronous execution       │
        │  OutboxDispatcher — DB → Redis bridge        │
        └──────────────────────────────────────────────┘
```

The platform separates:

```text
Discovery → Understanding → Deduplication → Story management
    → Editorial processing → Validation → Moderation
    → Scheduling → Publication → Reconciliation → Audit
```

---

## Repository structure

```text
content-platform/
│
├── apps/                       Application processes
│   ├── api/                    HTTP API and webhook ingress
│   ├── worker/                 Background workers and OutboxDispatcher
│   └── admin/                  Administrative UI
│
├── packages/                   Shared libraries
│   └── database/               Drizzle schema, migrations, repositories
│
├── docs/                       Documentation
│   ├── adr/                    Architecture Decision Records
│   ├── architecture/           System and domain documentation
│   ├── conventions/            Development conventions
│   └── operations/             Deployment and operational runbooks
│
├── scaffold/                   Repository bootstrap scripts (local only)
│
├── .github/                    GitHub configuration and templates
├── .vscode/                    Shared VS Code settings
│
├── package.json                Root workspace configuration
├── pnpm-workspace.yaml         Workspace definition and version overrides
├── tsconfig.base.json          Shared TypeScript configuration
├── eslint.config.js            ESLint flat configuration
├── prettier.config.js          Prettier configuration
└── README.md                   This file
```

---

## Documentation map

Documentation follows a **source-of-truth hierarchy**. Where two documents
disagree, the higher-level document wins.

```text
1. Domain and architecture contracts
2. DB v1 Logical Model Specification
3. DATABASE_SCHEMA_CONTRACT.md
4. Drizzle schema implementation
5. Generated PostgreSQL migrations
```

| Document                                                             | Purpose                                                        |
| -------------------------------------------------------------------- | -------------------------------------------------------------- |
| [`TECHNICAL_SPECIFICATION.md`](./TECHNICAL_SPECIFICATION.md)         | System behavior, state machines, failure modes, observability. |
| [`LOGICAL_MODEL_SPECIFICATION.md`](./LOGICAL_MODEL_SPECIFICATION.md) | DB v1 logical ingestion, provenance, and clustering model.     |
| [`DATABASE_SCHEMA_CONTRACT.md`](./DATABASE_SCHEMA_CONTRACT.md)       | Physical PostgreSQL persistence contract (v1.2, 44 tables).    |
| [`docs/README.md`](./docs/README.md)                                 | Documentation index and reading order.                         |
| [`docs/adr/`](./docs/adr/)                                           | Architecture Decision Records.                                 |
| [`docs/architecture/`](./docs/architecture/)                         | System overview, domain model, module map.                     |
| [`docs/conventions/`](./docs/conventions/)                           | Coding standards, commit conventions, migration rules.         |
| [`docs/operations/`](./docs/operations/)                             | Local setup, deployment, operational runbooks.                 |

---

## Getting started

### Prerequisites

| Tool    | Version     | Install                                                                |
| ------- | ----------- | ---------------------------------------------------------------------- |
| Node.js | `>= 22.0.0` | <https://nodejs.org> or `nvm use`                                      |
| pnpm    | `>= 12.0.0` | `corepack enable && corepack prepare pnpm@12.3.4 --activate`           |
| Git     | `>= 2.40`   | <https://git-scm.com>                                                  |
| Docker  | `>= 24.0`   | <https://docs.docker.com/get-docker/> (for local PostgreSQL and Redis) |

### Installation

```bash
git clone git@github.com:ARTeomo/content-platform.git
cd content-platform
pnpm install
```

The `prepare` script wires up Husky hooks. The `commit-msg` hook enforces
the commit message convention (see
[`docs/conventions/commits.md`](./docs/conventions/commits.md)).

### Local development

Local PostgreSQL and Redis run through Docker Compose (see
[`docs/operations/local-development.md`](./docs/operations/local-development.md)).

```bash
cp .env.example .env          # fill in local secrets
docker compose up -d          # start PostgreSQL and Redis
pnpm db:migrate               # apply migrations to the local database
pnpm typecheck                # TypeScript project references
pnpm test                     # run the test suite
```

### Database commands

```bash
pnpm db:generate              # generate a new migration from the Drizzle schema
pnpm db:check                 # verify migration consistency (no DB connection)
pnpm db:migrate               # apply pending migrations
pnpm db:studio                # launch Drizzle Studio
```

---

## Development workflow

### Commit convention

This project follows [Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/).
See [`docs/conventions/commits.md`](./docs/conventions/commits.md) for
the full rules, including the locked type vocabulary and the recommended
scope list.

### Branch strategy

| Branch    | Purpose                                                 |
| --------- | ------------------------------------------------------- |
| `main`    | Production-ready. Every commit on `main` is deployable. |
| `feat/*`  | Feature work. Squash-merged into `main`.                |
| `fix/*`   | Bug fixes. Squash-merged into `main`.                   |
| `docs/*`  | Documentation-only changes.                             |
| `chore/*` | Tooling and housekeeping.                               |

### Code review

Every change to `main` goes through a pull request. The PR template in
[`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md)
lists the checklist that reviewers expect to see completed.

### Schema changes

Any change to the Drizzle schema must be reflected in
[`DATABASE_SCHEMA_CONTRACT.md`](./DATABASE_SCHEMA_CONTRACT.md) **before**
the schema is modified. See the "Implementation gate" note at the bottom
of that document.

---

## Project status

**Pre-implementation.** The architecture, logical model, and database
schema contract are frozen. The Drizzle schema and migration set are
implemented.

### Implemented

- [x] DB v1.2 schema — **44 tables**
- [x] **14 migrations** (`0000` – `0013`), clean baseline
- [x] `pgcrypto` extension registered in the baseline migration
- [x] Partial index `publications(external_post_id) WHERE ... IS NOT NULL`
- [x] Deferred FK `external_interactions.publication_id` → `publications.id`
- [x] `TransactionManager` (the `run(fn)` API)
- [x] Six repositories:
  - `OutboxRepository`
  - `WebhookSubscriptionsRepository`
  - `WebhookSubscriptionHealthRepository`
  - `WebhookEventsRepository`
  - `WebhookDeliveriesRepository`
  - `ExternalInteractionsRepository`
- [x] Database client factory with health check and graceful shutdown
- [x] Monorepo toolchain (pnpm workspaces, TS project references, ESLint flat config)

### In progress

- [ ] Local development environment (Docker Compose for PostgreSQL and Redis)
- [ ] Integration test execution against a real PostgreSQL instance

### Next

- [ ] `MetaCredentialService` (encrypted credential lifecycle)
- [ ] Repository completion (publications, candidates, credentials, config, audit)
- [ ] `OutboxDispatcher` (PostgreSQL → BullMQ bridge)
- [ ] Webhook ingress route in `apps/api`
- [ ] `webhook.process` worker
- [ ] `webhook.respond` worker
- [ ] `MetaPublisherAdapter`
- [ ] Reconciliation schedulers

See [`docs/architecture/README.md`](./docs/architecture/README.md) for the
full architecture roadmap.

---

## Roadmap

| Phase            | Scope                                                             | Status      |
| ---------------- | ----------------------------------------------------------------- | ----------- |
| **v1.0 – v1.2**  | Database schema contract evolution                                | ✅ Complete |
| **Phase 1 – 13** | Drizzle schema implementation (44 tables)                         | ✅ Complete |
| **Phase 14**     | Local dev environment + integration tests                         | ⏳ Next     |
| **Phase 15**     | Credential lifecycle (`MetaCredentialService`)                    | ⏳          |
| **Phase 16**     | Outbox dispatcher + `webhook.process` worker                      | ⏳          |
| **Phase 17**     | Webhook ingress (`apps/api`)                                      | ⏳          |
| **Phase 18**     | Interaction response lifecycle (`webhook.respond`)                | ⏳          |
| **Phase 19**     | Meta publisher adapter and reconciliation                         | ⏳          |
| **v1.3**         | `webhook_endpoints`, multi-page Meta support                      | 📅 Planned  |
| **v1.4+**        | Analytics read models, materialized views, AI response generation | 📅 Planned  |

---

## Contributing

This is currently a single-maintainer project. Contributions will be
considered on a case-by-case basis once the implementation baseline is
complete and a public contribution process is defined.

Before opening a pull request, please ensure:

- `pnpm typecheck` passes
- `pnpm test` passes
- `pnpm format:check` passes
- Commit messages follow the project convention
- Any schema change is reflected in `DATABASE_SCHEMA_CONTRACT.md`

---

## License

Proprietary. All rights reserved. See the repository owner for licensing
details.

---

## Contact

- **Maintainer:** ARTeomo
- **Repository:** <https://github.com/ARTeomo/content-platform>
