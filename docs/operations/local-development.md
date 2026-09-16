# Local Development

This document describes the local development environment for the
Content Platform.

The platform supports two development paths:

1. **Cloud services (primary).** PostgreSQL on [Neon](https://neon.tech)
   and Redis on [Upstash](https://upstash.com). No local installation
   required. This is the supported path on the current development
   machine (Windows 10 1607, 4 GB RAM — see "Cloud services" below).
2. **Local Docker Compose (reference).** PostgreSQL and Redis in Docker
   containers. Requires Docker Desktop, which is not available on the
   current development machine. The `docker-compose.yml` file is
   retained for environments that support Docker.

Both paths use the same `.env` variables and the same commands. Only the
connection URLs differ.

---

## Prerequisites

| Tool           | Version     | Install                                                      | Required for    |
| -------------- | ----------- | ------------------------------------------------------------ | --------------- |
| Node.js        | `>= 22.0.0` | <https://nodejs.org> or `nvm use` (see `.nvmrc`)             | both paths      |
| pnpm           | `>= 12.0.0` | `corepack enable && corepack prepare pnpm@12.3.4 --activate` | both paths      |
| Git            | `>= 2.40`   | <https://git-scm.com>                                        | both paths      |
| Docker Desktop | `>= 4.30`   | <https://docs.docker.com/get-docker/>                        | local path only |

On Windows, Docker Desktop must use the WSL 2 backend for reliable
volume performance. Git Bash is the recommended shell.

**Docker Desktop requirements** (from Docker's documentation):

- Windows 10 64-bit, version 22H2 (build 19045) or higher
- Windows 11 64-bit, version 23H2 (build 22631) or higher
- WSL version 2.1.5 or later
- 8 GB RAM minimum

Machines that do not meet these requirements should use the cloud
services path.

---

## Cloud services

The primary development path uses two managed cloud services. Both have
free tiers that are sufficient for development.

### PostgreSQL — Neon

1. Sign up at <https://neon.tech> (GitHub OAuth is fastest).
2. Create a project:
   - **Name:** `content-platform`
   - **Region:** `eu-central-1` (Frankfurt)
   - **Postgres version:** 16
3. Create a second database for tests:
   - Neon console → **Databases** → **New Database**
   - **Name:** `content_platform_test`
   - **Owner:** the same user as the main database
4. Copy **two** connection strings from the Connection Details panel:

   | Connection | Purpose                            | Hostname            |
   | ---------- | ---------------------------------- | ------------------- |
   | **Direct** | Migrations (`drizzle-kit migrate`) | no `-pooler` suffix |
   | **Pooled** | Tests and application runtime      | contains `-pooler`  |

   `drizzle-kit migrate` uses prepared statements that PgBouncer
   (transaction mode) does not support. Migrations **must** use the
   direct connection. Tests may use either; the direct connection is
   simpler and adequate.

   Example direct URL:

   ```
   postgresql://user:pass@ep-xxx.eu-central-1.aws.neon.tech/content_platform?sslmode=require
   ```

   The `?sslmode=require` query parameter is required. The `postgres.js`
   driver uses it automatically.

### Redis — Upstash

1. Sign up at <https://upstash.com> (GitHub OAuth is fastest).
2. Create a Redis database:
   - **Name:** `content-platform`
   - **Type:** Regional
   - **Region:** `eu-central-1` (same as Neon)
   - **TLS:** Enabled (required by BullMQ)
   - **Eviction:** Disabled (BullMQ requires no data loss)
3. Copy the connection string from the **Connect** panel. Upstash shows
   it in two formats:

   | Upstash panel   | Format                       | Example                                                       |
   | --------------- | ---------------------------- | ------------------------------------------------------------- |
   | `ioredis` tab   | `rediss://`                  | `rediss://default:pass@xxx.upstash.io:6379`                   |
   | `redis-cli` tab | `redis://` with `--tls` flag | `redis-cli --tls -u redis://default:pass@xxx.upstash.io:6379` |

   **Use the `rediss://` scheme** (with two `s`) in `.env`. The
   `redis://` scheme from the `redis-cli` tab works too — the platform's
   `redisOptionsFromUrl` parser auto-detects `*.upstash.io` hostnames
   and enables TLS regardless of the scheme.

   Two options must be set on the Upstash side:

   - **TLS:** Enabled. Required by the BullMQ connection.
   - **Eviction:** Disabled. BullMQ stores job state in Redis; eviction
     would lose in-flight work.

---

## Docker Compose (reference)

The repository includes a `docker-compose.yml` at the root. It is
retained as a reference for environments that support Docker Desktop.
It is **not used** by the current development workflow.

### What it provisions

| Service    | Image                | Ports  |
| ---------- | -------------------- | ------ |
| `postgres` | `postgres:16-alpine` | `5432` |
| `redis`    | `redis:7-alpine`     | `6379` |

The PostgreSQL service creates the `content_platform` database and a
`content` user with the password `content`. An initialization script in
`docker/postgres/init/` also creates `content_platform_test`.

Redis runs with AOF persistence (`appendfsync everysec`).

### Usage

```bash
docker compose up -d        # start the services
docker compose ps           # check the status
docker compose logs -f      # tail logs
docker compose down         # stop the services
docker compose down -v      # stop and delete volumes (destructive)
```

### Switching to Docker Compose

Change `.env` to:

```bash
DATABASE_URL=postgresql://content:content@localhost:5432/content_platform
TEST_DATABASE_URL=postgresql://content:content@localhost:5432/content_platform_test
REDIS_URL=redis://localhost:6379
TEST_REDIS_URL=redis://localhost:6379
```

No other changes are required. The platform's connection parsers
handle both `localhost` and cloud URLs.

---

## First-time setup

### 1. Clone and install

```bash
git clone git@github.com:ARTeomo/content-platform.git
cd content-platform

# Activate the pinned Node version
nvm use                  # or: nvm install

# Install dependencies — postinstall builds every workspace package
pnpm install
```

The `postinstall` script (`pnpm -r --if-present run build`) builds every
workspace package automatically. The `prepare` script (`husky || true`)
wires up the Git hooks.

### 2. Create the environment file

```bash
cp .env.example .env
```

Edit `.env` with the values from the two cloud services. Required:

```bash
# Neon — use the Direct connection string
DATABASE_URL=postgresql://user:pass@ep-xxx.eu-central-1.aws.neon.tech/content_platform?sslmode=require
TEST_DATABASE_URL=postgresql://user:pass@ep-xxx.eu-central-1.aws.neon.tech/content_platform_test?sslmode=require

# Upstash — use the rediss:// scheme
REDIS_URL=rediss://default:pass@xxx.upstash.io:6379
TEST_REDIS_URL=rediss://default:pass@xxx.upstash.io:6379

# Encryption keys (required by the credential layer)
WEBHOOK_TOKEN_ENCRYPTION_KEY=<base64-encoded 32-byte key>
META_CREDENTIAL_ENCRYPTION_KEYS={"1":"<base64-encoded 32-byte key>"}
META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION=1
```

Generate a 32-byte key with:

```bash
openssl rand -base64 32
```

Only `DATABASE_URL`, `TEST_DATABASE_URL`, `REDIS_URL`, and
`TEST_REDIS_URL` are needed to run the current test suite. The
encryption keys are required when the credential or webhook ingress
tests are added.

### 3. Apply migrations

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)"
export TEST_DATABASE_URL="$(grep '^TEST_DATABASE_URL=' .env | cut -d= -f2-)"

# Main database
pnpm db:migrate

# Test database
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @content-platform/database db:migrate
```

### 4. Run the test suite

```bash
export REDIS_URL="$(grep '^REDIS_URL=' .env | cut -d= -f2-)"
export TEST_REDIS_URL="$(grep '^TEST_REDIS_URL=' .env | cut -d= -f2-)"

pnpm test
```

Expected: **67 tests passing** across three workspace packages.

---

## Database migrations

```bash
pnpm db:generate              # generate a new migration from the Drizzle schema
pnpm db:check                 # verify migration consistency (no DB connection)
pnpm db:migrate               # apply pending migrations to DATABASE_URL
pnpm db:studio                # launch Drizzle Studio
```

Migrations are applied in the order defined by the `meta/_journal.json`
file in `packages/database/migrations/`. The current baseline has 14
migrations (`0000` – `0013`).

The `pgcrypto` extension is created in migration `0000`. Later
migrations inherit it and must not re-declare it.

---

## Running tests

Repository and worker integration tests require both a running
PostgreSQL and a running Redis. The cloud services provide both.

```bash
# Load all four env vars
export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)"
export TEST_DATABASE_URL="$(grep '^TEST_DATABASE_URL=' .env | cut -d= -f2-)"
export REDIS_URL="$(grep '^REDIS_URL=' .env | cut -d= -f2-)"
export TEST_REDIS_URL="$(grep '^TEST_REDIS_URL=' .env | cut -d= -f2-)"

# Full suite
pnpm test

# Per package
pnpm --filter @content-platform/database test
pnpm --filter @content-platform/authentication test
pnpm --filter @content-platform/worker test

# Watch mode for a single package
pnpm --filter @content-platform/database test:watch
```

Tests that require a database or Redis are marked
`describe.skipIf(!TEST_DB_URL)` or `describe.skipIf(!TEST_DB_URL ||
!TEST_REDIS_URL)`. They are skipped silently when the env variable is
missing, so a partial run is always possible.

### Test database isolation

Integration tests use `TRUNCATE ... RESTART IDENTITY CASCADE` in their
`beforeEach` hooks. They never touch production data, but they do wipe
every row in the tables they exercise. Use the `content_platform_test`
database — never the main `content_platform` database.

### Test file parallelism

Every workspace package sets `fileParallelism: false` in its
`vitest.config.ts`. Integration tests share a single PostgreSQL database
and a single Redis instance. Running test files in parallel would cause
one file's `TRUNCATE ... CASCADE` to wipe another file's in-flight rows.

---

## TypeScript and tooling

```bash
pnpm typecheck                # project references, no emit
pnpm build                    # build every workspace package
pnpm format                   # Prettier write
pnpm format:check             # Prettier check
pnpm lint                     # ESLint flat config
pnpm lint:fix                 # ESLint autofix
```

The TypeScript compiler is run through project references. Adding a new
package to the workspace requires:

1. Creating a `tsconfig.json` that extends `../../tsconfig.base.json`.
2. Adding the package to the root `tsconfig.json` `references` array.
3. Adding the package path to `pnpm-workspace.yaml` (already covered by
   the `apps/*` and `packages/*` globs).

### Rebuilding after source changes

`pnpm install` triggers `postinstall` only when the dependency graph
changes. If you edit a package's source and need the `dist/` output
refreshed (for example, to run the worker with `node dist/index.js`):

```bash
pnpm build
```

The test suite does not need a rebuild — each package's
`vitest.config.ts` aliases `@content-platform/database` to the source
directory, so tests always run against the latest code.

---

## Editor setup

The repository ships with shared VS Code settings in `.vscode/`. These
enable format-on-save, ESLint fix-on-save, and LF line endings.

Recommended extensions are listed in `.vscode/extensions.json`. VS Code
will prompt to install them on first open.

For non-VS Code editors, `.editorconfig` provides basic consistency.

---

## Commit convention

Commit messages follow [Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/).
The rules are in [`../conventions/commits.md`](../conventions/commits.md).
Husky enforces the format on `git commit`.

If you need to bypass the hook for a work-in-progress commit that will
be squashed later:

```bash
git commit --no-verify -m "wip"
```

`--no-verify` bypasses the `commit-msg` hook. Do not use it for commits
that will land on `main`.

---

## Troubleshooting

### `ECONNRESET` on the Redis connection

The Upstash URL scheme must be `rediss://` (with two `s`). See the
"Cloud services" section. The platform's `redisOptionsFromUrl` parser
also auto-detects `*.upstash.io` hostnames and enables TLS regardless
of the scheme, so `redis://default:pass@xxx.upstash.io:6379` works too.

Additional causes:

- **TLS not enabled on the Upstash database.** Check the Upstash
  console → database → Settings → TLS. It must be enabled.
- **IPv6 attempted before IPv4.** The parser forces `family: 4`.
- **Missing SNI.** The parser sets `tls.servername` to the hostname.

### `drizzle-kit migrate` — "prepared statement ... already exists"

The `DATABASE_URL` uses the pooled connection (hostname contains
`-pooler`). `drizzle-kit migrate` uses prepared statements that
PgBouncer in transaction mode does not support. Use the **Direct
connection** string from the Neon Connection Details panel.

### `PublicationsRepository is not a constructor`

The database package's `dist/` is stale. Run `pnpm build` to rebuild
it. This happens when a new export was added to the source but the
`dist/` was not regenerated. The test suite is unaffected — Vitest
aliases resolve to the source.

### `ERR_PNPM_IGNORED_BUILDS`

pnpm 10+ does not run postinstall scripts by default. The
`pnpm-workspace.yaml` declares the allowlist via
`onlyBuiltDependencies`. If a new dependency requires a build script,
add it to that list and re-run `pnpm install --no-frozen-lockfile`.

### `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`

The lockfile is out of sync with `pnpm-workspace.yaml`. Resolve with:

```bash
pnpm install --no-frozen-lockfile
```

### `Cannot find name 'process'`

The `@types/node` package is not visible to the TypeScript compiler. In
a package that uses Node APIs, ensure its `tsconfig.json` contains
`"types": ["node"]` in `compilerOptions`.

### `__dirname` warning from Vite

Vite's upcoming native config loader does not support `__dirname`. Use
`import.meta.dirname` in `vitest.config.ts` files. This is a warning
today and will be a hard error in a future Vitest release.

### Line ending warnings from Git

The `.gitattributes` file normalizes all text files to LF in the
repository. Windows working trees may show CRLF for `.bat`, `.cmd`, and
`.ps1` files. This is intentional. Do not disable `core.autocrlf`.

If line endings become corrupted:

```bash
git rm --cached -r .
git add .
git commit -m "fix: renormalize line endings"
```

### Tests time out after 30 seconds

Two common causes:

1. **Redis connection is hanging.** `ioredis` is waiting for a
   connection that will never be established. Verify
   `TEST_REDIS_URL` is set and the Upstash database is reachable:
   `redis-cli --tls -u <url> ping`.
2. **PostgreSQL connection is hanging.** Verify `TEST_DATABASE_URL`
   is set. The Neon free tier auto-suspends after 5 minutes of
   inactivity; the first query after suspension takes 1–2 seconds.

---

## Related documents

- [`../conventions/`](../conventions/) — development conventions
- [`../architecture/`](../architecture/) — system and domain documentation
- [`../../DATABASE_SCHEMA_CONTRACT.md`](../../DATABASE_SCHEMA_CONTRACT.md) — persistence contract
- [`../../HANDOFF.md`](../../HANDOFF.md) — current project state
