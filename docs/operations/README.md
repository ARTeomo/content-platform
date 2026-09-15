# Operations

This directory contains local development, deployment, and operational
documentation for the Content Platform.

---

## Documents

| Document                                         | Purpose                                                   |
| ------------------------------------------------ | --------------------------------------------------------- |
| [`local-development.md`](./local-development.md) | Local PostgreSQL and Redis via Docker Compose             |
| `deployment.md`                                  | _Placeholder — will be added before the first deployment_ |
| `runbook.md`                                     | _Placeholder — operational runbooks for common scenarios_ |
| `troubleshooting.md`                             | _Placeholder — common failure modes and remediation_      |

---

## Planned runbooks

The following runbooks will be added as the corresponding subsystems
reach production readiness:

- Meta credential failure
- Redis recovery
- PostgreSQL recovery
- Source failure
- Queue backlog
- Publication failure
- AI quota exhaustion
- VPS restart
- Database restore
- Application rollback
- Kill switch activation

Each runbook will follow the same structure:

```text
Symptom → Impact → Detection → Immediate action
       → Root cause → Long-term fix → Related runbooks
```

---

## Related documents

- [`../architecture/`](../architecture/) — system and domain documentation
- [`../conventions/`](../conventions/) — development conventions
- [`../../TECHNICAL_SPECIFICATION.md`](../../TECHNICAL_SPECIFICATION.md) — full behavioral specification
