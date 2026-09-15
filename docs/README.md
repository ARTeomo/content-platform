# Documentation

This directory contains the project's documentation. It is organized by
audience and by lifecycle stage, and it follows the project's
**source-of-truth hierarchy**.

---

## Source-of-truth hierarchy

Where two documents disagree, the higher-level document wins.

```text
1. Domain and architecture contracts
2. DB v1 Logical Model Specification
3. DATABASE_SCHEMA_CONTRACT.md
4. Drizzle schema implementation
5. Generated PostgreSQL migrations
```

**Practical consequence.** A change to the physical schema requires:

1. A revision of the higher-level contract if it affects meaning or
   relationships.
2. A revision of `DATABASE_SCHEMA_CONTRACT.md`.
3. A change to the Drizzle schema.
4. A generated migration.

Never the reverse order.

---

## Reading order

If you are new to the project, read in this order:

1. [`README.md`](../README.md) — project overview
2. [`architecture/system-overview.md`](./architecture/system-overview.md) — what the system does
3. [`architecture/domain-model.md`](./architecture/domain-model.md) — the domain concepts
4. [`architecture/data-model.md`](./architecture/data-model.md) — the persistence model at a glance
5. [`conventions/`](./conventions/) — how code is written in this repository
6. [`adr/`](./adr/) — why the architecture is the way it is
7. [`../TECHNICAL_SPECIFICATION.md`](../TECHNICAL_SPECIFICATION.md) — the full behavioral specification
8. [`../DATABASE_SCHEMA_CONTRACT.md`](../DATABASE_SCHEMA_CONTRACT.md) — the physical persistence contract

---

## Index

### Top-level specification documents

These live at the repository root because they are the canonical,
versioned contracts referenced by both code and documentation.

| Document                                                                 | Scope                                                                                           |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| [`../TECHNICAL_SPECIFICATION.md`](../TECHNICAL_SPECIFICATION.md)         | System architecture, behavior, state machines, failure modes, observability, testing, security. |
| [`../LOGICAL_MODEL_SPECIFICATION.md`](../LOGICAL_MODEL_SPECIFICATION.md) | DB v1 logical model for ingestion, provenance, normalization, deduplication, and clustering.    |
| [`../DATABASE_SCHEMA_CONTRACT.md`](../DATABASE_SCHEMA_CONTRACT.md)       | The physical PostgreSQL persistence contract (v1.2, 44 tables).                                 |

### `docs/adr/` — Architecture Decision Records

Why specific architectural decisions were made. Each ADR is a short
Markdown document. The index is in
[`adr/README.md`](./adr/README.md).

### `docs/architecture/`

System- and domain-level documentation:

| Document                                                               | Purpose                                               |
| ---------------------------------------------------------------------- | ----------------------------------------------------- |
| [`architecture/README.md`](./architecture/README.md)                   | Architecture index and roadmap                        |
| [`architecture/system-overview.md`](./architecture/system-overview.md) | System at a glance with diagrams                      |
| [`architecture/domain-model.md`](./architecture/domain-model.md)       | Domain entities, boundaries, and lifecycle            |
| [`architecture/data-model.md`](./architecture/data-model.md)           | The 44-table persistence model summarized by category |
| [`architecture/module-map.md`](./architecture/module-map.md)           | Package and directory layout, dependency rules        |

### `docs/conventions/`

How code is written in this repository:

| Document                                                             | Purpose                         |
| -------------------------------------------------------------------- | ------------------------------- |
| [`conventions/README.md`](./conventions/README.md)                   | Index and authority statement   |
| [`conventions/typescript.md`](./conventions/typescript.md)           | TypeScript style and strictness |
| [`conventions/database-schema.md`](./conventions/database-schema.md) | Drizzle schema conventions      |
| [`conventions/migrations.md`](./conventions/migrations.md)           | Migration workflow              |
| [`conventions/documentation.md`](./conventions/documentation.md)     | TSDoc and comment style         |
| [`conventions/commits.md`](./conventions/commits.md)                 | Commit message convention       |

### `docs/operations/`

Local development, deployment, and operational runbooks:

| Document                                                               | Purpose                                       |
| ---------------------------------------------------------------------- | --------------------------------------------- |
| [`operations/README.md`](./operations/README.md)                       | Operations index                              |
| [`operations/local-development.md`](./operations/local-development.md) | Local PostgreSQL and Redis via Docker Compose |

---

## Conventions used by these documents

- **Language:** English.
- **Code samples:** TypeScript, unless a shell command is implied.
- **Diagrams:** ASCII, box-and-arrow. No external diagram tooling is
  required to read them.
- **Cross-references:** relative links within the repository, absolute
  URLs only where the target is external.
- **Versioning:** each top-level specification carries its own version.
  Changes that affect meaning require a version bump.
