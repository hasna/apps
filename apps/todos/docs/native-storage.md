# Native Storage Boundary

`@hasna/todos` stays local-first. A normal install uses local SQLite and local
artifact files without network access, hosted credentials, SaaS accounts, or a
shared cloud runtime package.

Remote storage is explicit and repo-native. Internal Hasna deployments and
future SaaS wrappers should configure it through `HASNA_TODOS_*` variables and
provide the matching Postgres/S3 clients through the public `./storage` package
export.

## Modes

- `HASNA_TODOS_STORAGE_MODE=local`: default local SQLite/file behavior.
- `HASNA_TODOS_STORAGE_MODE=remote`: use a remote adapter backed by Postgres
  on AWS RDS and optional S3 artifact storage.
- `HASNA_TODOS_STORAGE_MODE=hybrid`: use a local plus remote adapter with
  explicit sync behavior.

Legacy hosted API toggles are not storage selectors. They must not change the
local CLI default.

## Native AWS Configuration

- `HASNA_TODOS_DATABASE_URL`: Postgres connection string for RDS-backed task
  state.
- `HASNA_TODOS_DATABASE_SSL`: boolean, defaults to `true`.
- `HASNA_TODOS_DATABASE_SCHEMA`: optional schema name for service-owned
  isolation.
- `HASNA_TODOS_S3_BUCKET`: optional artifact bucket.
- `HASNA_TODOS_S3_PREFIX`: object prefix, defaults to `todos/`.
- `HASNA_TODOS_AWS_REGION`: AWS region for S3 and RDS-adjacent operations.
- `HASNA_TODOS_S3_ENDPOINT`: optional endpoint for tests or compatible object
  stores.
- `HASNA_TODOS_S3_FORCE_PATH_STYLE`: boolean for local S3-compatible tests.
- `HASNA_TODOS_SYNC_BATCH_SIZE`: positive integer, defaults to `500`.
- `HASNA_TODOS_SYNC_DRY_RUN`: boolean sync preview flag.

Plain local-development fallbacks are accepted with the same names minus the
`HASNA_` prefix, for example `TODOS_STORAGE_MODE`, `TODOS_DATABASE_URL`, and
`TODOS_S3_BUCKET`. Public docs and wrappers should still prefer the canonical
`HASNA_TODOS_*` names.

Production secrets should follow the broader open package convention:

- `hasna/xyz/opensource/todos/prod/env`
- `hasna/xyz/opensource/todos/prod/rds`
- `hasna/xyz/opensource/todos/prod/s3`

The canonical production RDS target is the shared Hasna XYZ infra apps
Postgres cluster `hasna-xyz-infra-apps-prod-postgres`, database `todos`, and
runtime secret `hasna/xyz/opensource/todos/prod/rds`. Runtime wiring should set
`HASNA_TODOS_DATABASE_URL` from that secret. `TODOS_DATABASE_URL` is only a
plain fallback for local development or wrappers that have not yet migrated.

A SaaS wrapper owns tenant state, billing, accounts, deployment, observability,
and production secret wiring. The open package owns local storage, the public
storage contract, local tests, and explicit remote adapter interfaces.

## Public Adapter Exports

The public `@hasna/todos/storage` export now includes:

- `loadTodosStorageConfig` and `createTodosStorageAdapter` for mode selection.
- `STORAGE_TABLES`, `TODOS_STORAGE_ENV`, and `TODOS_STORAGE_FALLBACK_ENV` for
  wrapper provenance and explicit env mapping.
- `exportSqliteTodosStorageSnapshot` and `importSqliteTodosStorageSnapshot`
  for local SQLite state movement without a hosted service.
- `createHybridTodosStorageAdapter` for local SQLite CRUD with explicit
  Postgres-backed remote snapshot push/pull.
- `createPostgresTodosStorageAdapter` for pure remote CRUD backed by the same
  Postgres JSONB sync records and a caller-provided query client.
- `createPostgresTodosSyncStore` for RDS-backed snapshot push/pull and
  cross-machine sync cursors through a caller-provided Postgres query client.
- `createTodosS3ArtifactStore` for S3 object reads/writes/deletes through
  signed `fetch` requests and caller-provided credentials.
- `uploadRunArtifactsToS3` and `downloadRunArtifactsFromS3` for syncing
  locally stored `task_run_artifacts` bytes to and from S3 while keeping the
  local artifact metadata rows as the source of truth.

These exports are dependency-light by design. The open package does not bundle
platform billing, tenant tables, deployment code, or a cloud SDK. Internal
deployments and wrappers can provide `pg` clients, credentials, and secret
loading from their own runtime.

## Local Plan Markdown Artifacts

Project-scoped plans now have a local Markdown companion file. When the CLI
creates or completes a plan with a project scope, it writes:

```text
<project-root>/.hasna/todos/plans/<project-id>/<plan-slug>--<id8>.md
```

The SQLite plan row remains the registry source of truth. The Markdown file is
an offline-readable artifact for agents, reviews, handoffs, and branch work. It
does not use hosted APIs or SaaS tenant state.

Each file uses the `hasna.todos.plan/v1` schema in frontmatter:

```markdown
---
schema: "hasna.todos.plan/v1"
plan_id: "<stable plan UUID>"
plan_slug: "launch-plan"
project_id: "<stable project UUID>"
task_list_id: null
agent_id: null
stable_id: "<same stable plan UUID>"
name: "Launch Plan"
status: "active"
created_at: "2026-06-30T00:00:00.000Z"
updated_at: "2026-06-30T00:00:00.000Z"
artifact_updated_at: "2026-06-30T00:00:00.000Z"
---

# Launch Plan

## Tasks

- [ ] Example task
  <!-- todos: task_id=<task-id> status=pending priority=medium -->
```

The path resolver only accepts safe project and plan path segments and resolves
projects from local SQLite by project ID, registered path, task-list slug, or
project-name slug. Unscoped plans keep the previous DB-only behavior because
the artifact layout is explicitly under `<project-id>`.

`todos plans --show <id-or-slug>` reads the companion file when present and
includes the parsed artifact metadata and body in JSON output. The text view
prints the artifact path. If a file is missing, the command still shows the
SQLite plan so older local databases remain compatible.

For backwards compatibility, artifact readers also check the legacy UUID path:

```text
<project-root>/.hasna/todos/plans/<project-id>/<plan-id>.md
```

When both files exist, the slugged `<plan-slug>--<id8>.md` artifact wins. A
future write or `--write-artifacts` run materializes the slugged artifact while
leaving legacy files untouched for operator review.

For migration and diagnostics:

```bash
todos plans --write-artifacts
todos plans --artifact <id-or-slug> --json
```

`--write-artifacts` materializes Markdown files for every project-scoped plan in
the current project scope using readable slug filenames. `--artifact` reports
the resolved file path, whether the file exists, parse errors, task references,
and deterministic conflicts between the SQLite row and Markdown
frontmatter/task comments. The CLI does not silently treat the Markdown file as
authoritative when conflicts exist; agents should resolve the conflict through
the CLI or an explicit migration task.

## Hybrid Sync Shape

`HASNA_TODOS_STORAGE_MODE=hybrid` can now build a local-plus-remote adapter when
the caller passes a Postgres-style query client or sync store:

- Local CRUD stays SQLite-backed and works offline.
- `adapter.sync.exportSnapshot()` and `adapter.sync.importSnapshot()` move the
  storage-level SQLite snapshot.
- `adapter.remote.pushSnapshot()` writes the local snapshot into Postgres sync
  records.
- `adapter.remote.pullSnapshot()` reads Postgres sync records and imports them
  into local SQLite.
- `adapter.remote.syncOnce()` pulls first, then pushes the merged local
  snapshot.

This is the open-package boundary. SaaS tenant wrappers can be added on top
without changing the local default or depending on a shared cloud package.

## Remote CRUD Shape

`HASNA_TODOS_STORAGE_MODE=remote` can now build a pure Postgres adapter when the
caller passes a Postgres-style query client to `createTodosStorageAdapter`:

- CRUD uses the repo-owned `todos_sync_records` JSONB table rather than SaaS
  tenant tables.
- The package does not import `pg`; wrappers or internal deployments provide
  the connected client.
- `createPostgresTodosStorageAdapter` is also exported directly for callers
  that want to bypass mode selection.
- Local SQLite remains the default unless `HASNA_TODOS_STORAGE_MODE` is set
  explicitly.

## S3 Artifact Sync

Run artifacts recorded with local stored content can now be pushed to S3 through
the public storage helpers:

- `uploadRunArtifactsToS3({ store, db, filter })` verifies the local
  content-addressed artifact bytes, uploads them using `createTodosS3ArtifactStore`,
  and stores a `remote_artifact_store` reference on the `task_run_artifacts`
  metadata row.
- `downloadRunArtifactsFromS3({ store, db, filter })` reads that remote
  reference, downloads the object, verifies the checksum, and restores the local
  content-addressed file.

The helper only needs a caller-provided S3 store. Credentials, secret loading,
tenant scoping, and production scheduling remain outside the open package.

The CLI exposes the same boundary:

- `todos storage artifacts upload --run-id <id> --json` previews uploadable
  local artifact bytes without network access.
- `todos storage artifacts download --run-id <id> --json` previews remote
  restore work without network access.
- Add `--apply` to perform the S3 operation. Apply mode requires
  `HASNA_TODOS_S3_BUCKET` plus `HASNA_TODOS_S3_ACCESS_KEY_ID` and
  `HASNA_TODOS_S3_SECRET_ACCESS_KEY`; `HASNA_TODOS_S3_SESSION_TOKEN` is
  optional.
