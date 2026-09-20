# Content Platform

> A domain-oriented, event-driven content discovery, analysis, moderation,
> scheduling, and publishing platform.

[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D12-F69220?logo=pnpm&logoColor=white)](https://pnpm.io)
[![TypeScript](https://img.shields.io/badge/typescript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-208%20passing-brightgreen)](#project-status)
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

It also **receives** inbound events from external providers (starting
with Meta), materializes them as first-class domain entities, and
produces governed outbound responses through a policy- and
moderation-controlled workflow.

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
| **Transactional outbox** | Every durable side effect enqueued through `outbox_jobs` in the same DB transaction.          |
| **Observability**        | Structured logs, metrics, trace IDs, health endpoints, audit trail.                           |

---

## Architecture at a glance

```text
                        EXTERNAL SOURCES                 META PLATFORM
                              |                                |
                              v                                |
                    +------------------+                       |
                    |  Source Poller   |                       |
                    +--------+---------+                       |
                             |                                 |
                    +--------v---------+                       |
                    |  Normalization   |                       |
                    |  Relevance       |                       |
                    |  Entities        |                       |
                    |  Deduplication   |                       |
                    |  Clustering      |                       |
                    +--------+---------+                       |
                             |                                 |
                    +--------v---------+       +---------------+---------+
                    |  Content         |       |  Webhook Ingress        |
                    |  Processing      |       |  (signature, idempot.)  |
                    |  Validation      |       +---------------+---------+
                    |  Moderation      |                       |
                    |  Scheduling      |                       v
                    +--------+---------+       +---------------------------+
                             |                 |  Webhook Processing       |
                             v                 |  Interaction Response     |
                    +------------------+       +-------------+-------------+
                    |  Publisher       |                     |
                    |  Adapter         |<--------------------+
                    |  (Meta)          |   (push reconciliation)
                    +--------+---------+
                             |
                             v
                       EXTERNAL POST

        =========================================================
                          Platform backbone
        +-------------------------------------------------------+
        |  PostgreSQL     -  system of record                   |
        |  outbox_jobs    -  transactional outbox               |
        |  Redis/BullMQ   -  asynchronous execution             |
        |  OutboxDispatcher - DB -> Redis bridge                |
        +-------------------------------------------------------+
```

The platform separates:

```text
OUTBOUND
  Discovery -> Understanding -> Deduplication -> Story management
    -> Editorial processing -> Validation -> Moderation
    -> Scheduling -> Publication -> Reconciliation -> Audit

INBOUND
  Webhook receipt -> Verification -> Persistence + outbox
    -> Processing -> Interaction materialization
    -> Policy decision -> Moderation -> Response execution
    -> Reconciliation -> Audit
```

---

## Repository structure

```text
content-platform/
|
+-- apps/                          Application processes
|   +-- api/                       Fastify webhook ingress (POST + GET)
|   |   +-- src/
|   |       +-- routes/webhooks/meta.ts
|   |       +-- routes/webhooks/signature.ts
|   |       +-- routes/webhooks/envelope.ts
|   |       +-- app.ts
|   |       +-- config.ts
|   +-- worker/                    Background workers + OutboxDispatcher
|   |   +-- src/
|   |       +-- config.ts          Environment loading
|   |       +-- index.ts           Worker entrypoint
|   |       +-- outbox-dispatcher.ts
|   |       +-- queue/             BullMQ abstractions
|   |       +-- webhook/           webhook.process service + extractors
|   |       +-- interaction-response/  webhook.respond + reconcile
|   |       +-- publication/       content.publish + scheduler + reconcile
|   |       +-- scripts/           Operational tooling (BullMQ inspection)
|   +-- admin/                     Administrative UI (planned)
|
+-- packages/                      Shared libraries
|   +-- database/                  Drizzle schema, migrations, repositories
|   |   +-- src/
|   |   |   +-- schema/            44 tables organized by domain
|   |   |   +-- repositories/      15 repository classes
|   |   |   +-- transaction/       TransactionManager
|   |   |   +-- client.ts          Database client factory
|   |   +-- migrations/            0000 - 0013
|   |   +-- scripts/               Operational scripts
|   +-- authentication/            Credential encryption + Meta lifecycle
|   |   +-- src/
|   |       +-- encryption/        AES-256-GCM credential encryption provider
|   |       +-- meta/              MetaCredentialService + Graph API client
|   +-- interaction-response/      Policy engine + template renderer
|   +-- publishers/                Meta adapters + rate limiter
|       +-- src/meta/
|           +-- meta-interaction-adapter.ts
|           +-- meta-publisher-adapter.ts
|           +-- meta-response-reconciler.ts
|           +-- meta-publication-reconciler.ts
|           +-- meta-rate-limiter.ts
|
+-- docs/                          Documentation
|   +-- adr/                       Architecture Decision Records
|   +-- architecture/              Normative technical specifications
|   +-- audit/                     Baseline audits (not normative)
|   +-- conventions/               Development conventions
|   +-- operations/                Deployment and operational runbooks
|
+-- scaffold/                      Repository bootstrap scripts (local only)
+-- .github/                       GitHub configuration and templates
+-- .vscode/                       Shared VS Code settings
|
+-- HANDOFF.md                     Session boundary snapshot
+-- docker-compose.yml             (reference) local services definition
+-- package.json                   Root workspace configuration
+-- pnpm-workspace.yaml            Workspace definition and version overrides
+-- tsconfig.base.json             Shared TypeScript configuration
+-- eslint.config.js               ESLint flat configuration
+-- prettier.config.js             Prettier configuration
+-- README.md                      This file
```

---

## Documentation map

Documentation follows a **source-of-truth hierarchy**. Where two documents
disagree, the higher-level document wins.

```text
1. Domain and architecture contracts
2. TECHNICAL_SPECIFICATION.md v0.9.0
3. LOGICAL_MODEL_SPECIFICATION.md v1.0
4. DATABASE_SCHEMA_CONTRACT.md v1.2
5. META_INTEGRATION_SPECIFICATION.md v1.4
6. Drizzle schema implementation
7. Generated PostgreSQL migrations
```

Audit documents (`docs/audit/`) are **not** part of the source-of-truth
hierarchy. They are a reflection on the state, not a normative reference.

| Document                                                                                     | Purpose                                                                  |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [`TECHNICAL_SPECIFICATION.md`](./docs/architecture/TECHNICAL_SPECIFICATION.md)               | Platform-wide system behavior, state machines, failure modes.            |
| [`LOGICAL_MODEL_SPECIFICATION.md`](./docs/architecture/LOGICAL_MODEL_SPECIFICATION.md)       | DB v1 logical ingestion, provenance, and clustering model.               |
| [`DATABASE_SCHEMA_CONTRACT.md`](./docs/architecture/DATABASE_SCHEMA_CONTRACT.md)             | Physical PostgreSQL persistence contract (v1.2, 44 tables).              |
| [`META_INTEGRATION_SPECIFICATION.md`](./docs/architecture/META_INTEGRATION_SPECIFICATION.md) | Meta-specific behavioral authority (v1.4).                               |
| [`HANDOFF.md`](./HANDOFF.md)                                                                 | Current state snapshot for session continuity.                           |
| [`docs/README.md`](./docs/README.md)                                                         | Documentation index and reading order.                                   |
| [`docs/adr/`](./docs/adr/)                                                                   | Architecture Decision Records.                                           |
| [`docs/architecture/`](./docs/architecture/)                                                 | System overview, domain model, module map, and normative specifications. |
| [`docs/audit/`](./docs/audit/)                                                               | Baseline audits reflecting implementation against baseline.              |
| [`docs/conventions/`](./docs/conventions/)                                                   | Coding standards, commit conventions, migration rules.                   |
| [`docs/operations/`](./docs/operations/)                                                     | Local setup, deployment, operational runbooks.                           |

---

## Getting started

### Prerequisites

| Tool    | Version     | Install                                                      |
| ------- | ----------- | ------------------------------------------------------------ |
| Node.js | `>= 22.0.0` | <https://nodejs.org> or `nvm use` (see `.nvmrc`)             |
| pnpm    | `>= 12.0.0` | `corepack enable && corepack prepare pnpm@12.3.4 --activate` |
| Git     | `>= 2.40`   | <https://git-scm.com>                                        |

**Cloud services** (no local installation required):

| Service       | Purpose          | Provider                       |
| ------------- | ---------------- | ------------------------------ |
| PostgreSQL 16 | System of record | [Neon](https://neon.tech)      |
| Redis 7 (TLS) | BullMQ queue     | [Upstash](https://upstash.com) |

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

### Running the worker

The worker process owns the outbox dispatcher, the publication scheduler,
and all BullMQ consumers:

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)"
export REDIS_URL="$(grep '^REDIS_URL=' .env | cut -d= -f2-)"
export META_PAGE_ACCESS_TOKEN="$(grep '^META_PAGE_ACCESS_TOKEN=' .env | cut -d= -f2-)"
export META_GRAPH_API_VERSION="$(grep '^META_GRAPH_API_VERSION=' .env | cut -d= -f2-)"

pnpm --filter @content-platform/worker start
```

### Running the API

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)"
export META_APP_SECRET="$(grep '^META_APP_SECRET=' .env | cut -d= -f2-)"
export WEBHOOK_TOKEN_ENCRYPTION_KEY="$(grep '^WEBHOOK_TOKEN_ENCRYPTION_KEY=' .env | cut -d= -f2-)"

pnpm --filter @content-platform/api dev
```

---

## Development workflow

### Commit convention

This project follows [Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/).
See [`docs/conventions/commits.md`](./docs/conventions/commits.md) for
the full rules, including the locked type vocabulary and the recommended
scope list.

Common types and scopes in this repository:

```text
feat(worker)         feat(publication)     feat(api)
fix(publication)     fix(queue)            fix(webhook)
chore(scripts)       chore(env)
docs(spec)           docs(audit)           docs
```

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
[`DATABASE_SCHEMA_CONTRACT.md`](./docs/architecture/DATABASE_SCHEMA_CONTRACT.md)
**before** the schema is modified. See the "Implementation gate" note at
the bottom of that document.

---

## Project status

**Phase 19 complete.** The architecture, logical model, and database
schema contract are frozen and stable. The complete two-way Meta
integration (inbound webhook + outbound publication + interaction
response) is implemented and verified end-to-end against the real Meta
Graph API.

### Workspace

Six workspace packages:

| Package                         | Purpose                                                                                                                     |   Tests |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------: |
| `packages/database`             | Drizzle schema, migrations, 15 repositories, `TransactionManager`                                                           |      22 |
| `packages/authentication`       | AES-256-GCM, `MetaCredentialService`, Graph API client, `MetaErrorMapper`                                                   |      37 |
| `packages/interaction-response` | Policy engine, template renderer (pure, deterministic)                                                                      |      21 |
| `packages/publishers`           | `MetaInteractionAdapter`, `MetaPublisherAdapter`, reconcilers, rate limiter                                                 |      51 |
| `apps/worker`                   | `OutboxDispatcher`, publication scheduler, `webhook.process`, `webhook.respond`, `content.publish`, `publication.reconcile` |      73 |
| `apps/api`                      | Fastify webhook ingress (POST + GET)                                                                                        |       4 |
| **Total**                       |                                                                                                                             | **208** |

### Implemented

- [x] DB v1.2 schema — **44 tables**
- [x] **14 migrations** (`0000` – `0013`), applied to Neon PostgreSQL
- [x] `pgcrypto` extension registered in the baseline migration
- [x] Partial index `publications(external_post_id) WHERE ... IS NOT NULL`
- [x] Partial unique index `provider_credentials_unique` with `COALESCE`
- [x] Deferred FK `external_interactions.publication_id -> publications.id`
- [x] `TransactionManager` (the `run(fn)` API)
- [x] `createDatabaseClient` factory with health check and graceful shutdown
- [x] **15 repositories**:
  - `OutboxRepository`
  - `WebhookSubscriptionsRepository`
  - `WebhookSubscriptionHealthRepository`
  - `WebhookEventsRepository`
  - `WebhookDeliveriesRepository`
  - `ExternalInteractionsRepository`
  - `DestinationsRepository`
  - `ProviderCredentialsRepository`
  - `PublicationsRepository` (including `claimForPublishing`)
  - `PublicationAttemptsRepository`
  - `PublicationReconciliationsRepository`
  - `InteractionResponsesRepository`
  - `InteractionResponseAttemptsRepository`
  - `InteractionModerationActionsRepository`
  - `InteractionResponseReconciliationsRepository`
- [x] **Credential encryption** (AES-256-GCM with AAD binding and key rotation)
- [x] **`MetaCredentialService`** (store / rotate / invalidate / validate / healthCheck)
- [x] **`MetaErrorMapper`** (Graph API error categorization)
- [x] **`OutboxDispatcher`** (PG -> BullMQ bridge with stale recovery and cleanup)
- [x] **BullMQ abstractions** (`JobQueue`, `BullMqJobQueue`, `BullMqJobConsumer`)
- [x] **Webhook ingress** (`apps/api`, signature verification + transaction + outbox)
- [x] **`webhook.process` worker** with change extractor registry
- [x] **Change extractors** for `feed` (COMMENT, REACTION) and `mention`
- [x] **Interaction response lifecycle** (policy, moderation, execution, reconciliation)
- [x] **Publication scheduler** (`PublicationSchedulerService` + worker)
- [x] **Outbound publication** (`content.publish`, `MetaPublisherAdapter`)
- [x] **Publication reconciliation** (`publication.reconcile`, `MetaPublicationReconciler`)
- [x] **Real Meta E2E verified** (Phase 18a inbound, Phase 19e outbound)
- [x] Monorepo toolchain (pnpm workspaces, TS project references, ESLint flat config)
- [x] **208 passing tests** against real PostgreSQL and Redis

### Baseline audit findings (open)

A baseline audit was performed against the original three baseline
documents. It identified seven findings that are not yet closed in the
runtime. These are tracked in
[`docs/audit/baseline-audit-20-09-2026.md`](./docs/audit/baseline-audit-20-09-2026.md).

| Finding | Summary                                                         | Spec reference         |
| ------- | --------------------------------------------------------------- | ---------------------- |
| F1      | Webhook ingress transaction boundary (interpretation-dependent) | Meta spec §9.5         |
| F2      | Interaction response config not loaded from `system_config`     | Meta spec §15.1        |
| F3      | Interaction response rate limiter is a no-op                    | Meta spec §30.3        |
| F4      | Publication rate limiter is a no-op                             | Meta spec §30.1, §30.3 |
| F5      | Credential service not wired into worker outbound path          | Meta spec §26.8        |
| F6      | Scheduler credential-health gate missing                        | Meta spec §22.3        |
| F7      | Outbox `system.rebuild` / dedicated cleanup contract            | Meta spec §43.5, §44   |

None of these block the DB v1.3 milestone. They are scheduled as
priority-1 (F5, F6), priority-2 (F2, F3, F4) and priority-3 (F7)
remediation work.

### Next

- [ ] **DB v1.3** — `webhook_endpoints` + multi-page Meta support
- [ ] Credential service integration into the worker outbound path (F5)
- [ ] Scheduler credential-health gate (F6)
- [ ] Configuration loading from `system_config` (F2)
- [ ] Real rate-limiter enforcement (F3, F4)
- [ ] `system.rebuild` / `system.outbox.cleanup` queue wiring (F7)
- [ ] Admin UI (`apps/admin`)
- [ ] Analytics read models (`meta_posts`, `meta_comments`, `meta_reactions`)

See [`docs/architecture/META_INTEGRATION_SPECIFICATION.md`](./docs/architecture/META_INTEGRATION_SPECIFICATION.md)
for the Meta boundary contract, and
[`HANDOFF.md`](./HANDOFF.md) for the current state snapshot.

---

## Roadmap

| Phase              | Scope                                                             | Status   |
| ------------------ | ----------------------------------------------------------------- | -------- |
| **v1.0 – v1.2**    | Database schema contract evolution                                | Complete |
| **Phase 1 – 13**   | Drizzle schema implementation (44 tables)                         | Complete |
| **Phase 14**       | Local dev environment (Neon + Upstash)                            | Complete |
| **Phase 15**       | Credential lifecycle (`MetaCredentialService`)                    | Complete |
| **Phase 16**       | Outbox dispatcher (PG -> BullMQ)                                  | Complete |
| **Phase 17 / 18a** | Webhook ingress (`apps/api`) + real Meta inbound E2E              | Complete |
| **Phase 18b**      | Interaction response lifecycle (`webhook.respond`)                | Complete |
| **Phase 19a**      | Outbound publication execution (`content.publish`)                | Complete |
| **Phase 19b**      | Uncertain-outcome reconciliation foundation                       | Complete |
| **Phase 19c**      | Publication reconciliation worker/service/reconciler              | Complete |
| **Phase 19d**      | Publication scheduler                                             | Complete |
| **Phase 19e**      | Real Meta outbound E2E + hardening                                | Complete |
| **v1.3**           | `webhook_endpoints`, multi-page Meta support                      | Next     |
| **v1.4+**          | Analytics read models, materialized views, AI response generation | Planned  |

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
