# Local Development

This document describes the local development environment for the
Content Platform.

---

## Prerequisites

| Tool           | Version     | Install                                                      |
| -------------- | ----------- | ------------------------------------------------------------ |
| Node.js        | `>= 22.0.0` | <https://nodejs.org> or `nvm use` (see `.nvmrc`)             |
| pnpm           | `>= 12.0.0` | `corepack enable && corepack prepare pnpm@12.3.4 --activate` |
| Docker Desktop | `>= 4.30`   | <https://docs.docker.com/get-docker/>                        |
| Git            | `>= 2.40`   | <https://git-scm.com>                                        |

On Windows, Docker Desktop must use the WSL 2 backend for reliable
volume performance. Git Bash is the recommended shell.

---

## First-time setup

```bash
# 1. Clone the repository
git clone git@github.com:ARTeomo/content-platform.git
cd content-platform

# 2. Activate the pinned Node version
nvm use                  # or: nvm install

# 3. Install dependencies
pnpm install

# 4. Create the local environment file
cp .env.example .env
```

Then edit `.env` and set at least the following values:

```bash
DATABASE_URL=postgresql://content:content@localhost:5432/content_platform
REDIS_URL=redis://localhost:6379
WEBHOOK_TOKEN_ENCRYPTION_KEY=<base64-encoded 32-byte key>
META_CREDENTIAL_ENCRYPTION_KEYS={"1":"<base64-encoded 32-byte key>"}
META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION=1
```

Generate a 32-byte key with:

```bash
openssl rand -base64 32
```

`DATABASE_URL` and `REDIS_URL` are the only variables required to run
the database migrations and repository tests.

---

## Docker Compose

Local PostgreSQL and Redis are managed by Docker Compose. The
`docker-compose.yml` file will be added at the repository root as part
of Phase 14. It will provision:

| Service    | Image                | Ports  |
| ---------- | -------------------- | ------ |
| `postgres` | `postgres:16-alpine` | `5432` |
| `redis`    | `redis:7-alpine`     | `6379` |

The PostgreSQL service will create the `content_platform` database and
a `content` user with the password from `DATABASE_URL`.

### Planned usage

```bash
docker compose up -d        # start the services
docker compose ps           # check the status
docker compose logs -f      # tail logs
docker compose down         # stop the services
docker compose down -v      # stop and delete volumes (destructive)
```

---

## Database migrations

```bash
pnpm db:generate              # generate a new migration from the Drizzle schema
pnpm db:check                 # verify migration consistency (no DB connection)
pnpm db:migrate               # apply pending migrations to DATABASE_URL
pnpm db:studio                # launch Drizzle Studio
```

Migrations are applied in the order defined by the `meta/_journal.json`
file in `packages/database/migrations/`.

---

## Running tests

Repository integration tests require a running PostgreSQL instance.

```bash
# Apply migrations to the test database
TEST_DATABASE_URL=postgresql://content:content@localhost:5432/content_platform_test \
  pnpm db:migrate

# Run the full test suite
TEST_DATABASE_URL=postgresql://content:content@localhost:5432/content_platform_test \
  pnpm test

# Run a specific test file in watch mode
TEST_DATABASE_URL=postgresql://content:content@localhost:5432/content_platform_test \
  pnpm --filter @content-platform/database test:watch
```

Tests that do not require a database connection run without
`TEST_DATABASE_URL` and are marked `describe.skipIf(!TEST_DB_URL)`.

---

## TypeScript and tooling

```bash
pnpm typecheck                # project references, no emit
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

---

## Related documents

- [`../conventions/`](../conventions/) — development conventions
- [`../architecture/`](../architecture/) — system and domain documentation
- [`../../DATABASE_SCHEMA_CONTRACT.md`](../../DATABASE_SCHEMA_CONTRACT.md) — persistence contract
