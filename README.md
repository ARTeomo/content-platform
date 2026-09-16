# Content Platform

> A domain-oriented, event-driven content discovery, analysis, moderation,
> scheduling, and publishing platform.

[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D12-F69220?logo=pnpm&logoColor=white)](https://pnpm.io)
[![TypeScript](https://img.shields.io/badge/typescript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-67%20passing-brightgreen)](#project-status)
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
│   ├── api/                    HTTP API and webhook ingress (planned)
│   ├── worker/                 Background workers and OutboxDispatcher
│   │   ├── src/
│   │   │   ├── config.ts       Environment loading
│   │   │   ├── index.ts        Worker entrypoint
│   │   │   ├── outbox-dispatcher.ts
│   │   │   ├── queue/          BullMQ abstractions (JobQueue, JobConsumer)
│   │   │   └── webhook/        webhook.process service + change extractors
│   │   └── package.json
│   └── admin/                  Administrative UI (planned)
│
├── packages/                   Shared libraries
│   ├── database/               Drizzle schema, migrations, repositories
│   │   ├── src/
│   │   │   ├── schema/         44 tables organized by domain
│   │   │   ├── repositories/   8 repositories
│   │   │   ├── transaction/    TransactionManager
│   │   │   └── client.ts       Database client factory
│   │   └── migrations/         0000 – 0013
│   └── authentication/         Credential encryption + Meta lifecycle
│       └── src/
│           ├── encryption/     AES-256-GCM credential encryption provider
│           └── meta/           MetaCredentialService + Graph API client
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
├── HANDOFF.md                  Session boundary snapshot
├── docker-compose.yml          (reference) local services definition
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
| [`HANDOFF.md`](./HANDOFF.md)                                         | Current state snapshot for session continuity.                 |
| [`docs/README.md`](./docs/README.md)                                 | Documentation index and reading order.                         |
| [`docs/adr/`](./docs/adr/)                                           | Architecture Decision Records.                                 |
| [`docs/architecture/`](./docs/architecture/)                         | System overview, domain model, module map.                     |
| [`docs/conventions/`](./docs/conventions/)                           | Coding standards, commit conventions, migration rules.         |
| [`docs/operations/`](./docs/operations/)                             | Local setup, deployment, operational runbooks.                 |

---

## Getting started

### Prerequisites

| Tool    | Version     | Install                                                      |
| ------- | ----------- | ------------------------------------------------------------ |
| Node.js | `>= 22.0.0` | <https://nodejs.org> or `nvm use` (see `.nvmrc`)             |
| pnpm    | `>= 12.0.0` | `corepack enable && corepack prepare pnpm@12.3.4 --activate` |
| Git     | `>= 2.40`   | <https://git-scm.com>                                        |

**Cloud services** (no local installation required):

| Service          | Purpose            | Provider                    |
| ---------------- | ------------------ | --------------------------- |
| PostgreSQL 16    | System of record   | [Neon](https://neon.tech)   |
| Redis 7 (TLS)    | BullMQ queue       | [Upstash](https://upstash.com) |

Docker is not required. Local development runs against these cloud
services, which matches the production topology and works on machines
that cannot run Docker Desktop.

### Installation

```bash
git clone git@github.com:ARTeomo/content-platform.git
cd content-platform
pnpm install
```

The `postinstall` script builds every workspace package automatically.
The `prepare` script wires up Husky hooks. The `commit-msg` hook enforces
the commit message convention (see
[`docs/conventions/commits.md`](./docs/conventions/commits.md)).

### Local development

Set up the two cloud services and fill in `.env`. See
[`docs/operations/local-development.md`](./docs/operations/local-development.md)
for the full walkthrough.

```bash
cp .env.example .env          # fill in Neon + Upstash credentials
pnpm db:migrate               # apply migrations to Neon
pnpm typecheck                # TypeScript project references
pnpm test                     # run the full test suite
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

**Active development.** The architecture, logical model, and database
schema contract are frozen. The schema, credential layer, outbox
dispatcher, and webhook processing pipeline are implemented and tested
against real cloud services.

### Implemented

- [x] DB v1.2 schema — **44 tables**
- [x] **14 migrations** (`0000` – `0013`), applied to Neon PostgreSQL
- [x] `pgcrypto` extension registered in the baseline migration
- [x] Partial index `publications(external_post_id) WHERE ... IS NOT NULL`
- [x] Partial unique index `provider_credentials_unique` with `COALESCE`
- [x] Deferred FK `external_interactions.publication_id` → `publications.id`
- [x] `TransactionManager` (the `run(fn)` API)
- [x] `createDatabaseClient` factory with health check and graceful shutdown
- [x] **Eight repositories:**
  - `OutboxRepository`
  - `WebhookSubscriptionsRepository`
  - `WebhookSubscriptionHealthRepository`
  - `WebhookEventsRepository`
  - `WebhookDeliveriesRepository`
  - `ExternalInteractionsRepository`
  - `ProviderCredentialsRepository`
  - `PublicationsRepository`
- [x] **Credential encryption** (AES-256-GCM with AAD binding and key rotation)
- [x] **MetaCredentialService** (store / rotate / invalidate / validate / healthCheck)
- [x] **MetaErrorMapper** (Graph API error categorization)
- [x] **OutboxDispatcher** (PG → BullMQ bridge with stale recovery and cleanup)
- [x] **BullMQ abstractions** (`JobQueue`, `BullMqJobQueue`, `BullMqJobConsumer`)
- [x] **`webhook.process` service** with change extractor registry
- [x] **Change extractors** for `feed` (COMMENT, REACTION) and `mention`
- [x] Monorepo toolchain (pnpm workspaces, TS project references, ESLint flat config)
- [x] **67 passing tests** against real PostgreSQL and Redis

### In progress

- [ ] Webhook ingress route in `apps/api` (signature verification + outbox enqueue)

### Next

- [ ] `webhook.respond` worker and interaction response policy engine
- [ ] `MetaInteractionAdapter` (outbound Graph API call)
- [ ] Push-reconciliation via the `feed` webhook
- [ ] `MetaPublisherAdapter` and publication reconciliation
- [ ] `MetaRateLimiter` extension for inbound/outbound engagement
- [ ] Admin UI (`apps/admin`)
- [ ] Analytics read models (`meta_posts`, `meta_comments`, `meta_reactions`)

See [`docs/architecture/README.md`](./docs/architecture/README.md) for the
full architecture roadmap.

---

## Roadmap

| Phase            | Scope                                                             | Status      |
| ---------------- | ----------------------------------------------------------------- | ----------- |
| **v1.0 – v1.2**  | Database schema contract evolution                                | ✅ Complete |
| **Phase 1 – 13** | Drizzle schema implementation (44 tables)                         | ✅ Complete |
| **Phase 14**     | Local dev environment (Neon + Upstash)                            | ✅ Complete |
| **Phase 15**     | Credential lifecycle (`MetaCredentialService`)                    | ✅ Complete |
| **Phase 16**     | Outbox dispatcher (PG → BullMQ)                                   | ✅ Complete |
| **Phase 17**     | `webhook.process` service + change extractors                     | ✅ Complete |
| **Phase 18a**    | Webhook ingress (`apps/api`)                                      | ⏳ Next     |
| **Phase 18b**    | Interaction response lifecycle (`webhook.respond`)                | ⏳          |
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
