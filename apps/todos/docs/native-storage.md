# Native Storage Boundary

`@hasna/todos` stays local-first where it is a local product. The MCP server,
`todos-serve`, the native storage tooling, and the plan-artifact surface run on
local SQLite and local artifact files without network access, hosted
credentials, SaaS accounts, or a shared cloud runtime package.

The CLI's client transport is NOT implicitly local. Since the fleet fail-closed
ruling (2026-09-04, hasna/apps#1613), a CLI run with neither API variable
present exits non-zero with an error naming `HASNA_TODOS_API_URL` and
`HASNA_TODOS_API_KEY` — it never silently serves the on-box SQLite store.
Serving local SQLite through the CLI requires the explicit opt-in
`HASNA_TODOS_LOCAL=1` (alias `TODOS_LOCAL=1`), which is how local-only CLI
deployments, self-hosters, and tests opt in deliberately.

Remote storage is explicit and repo-native. Internal Hasna deployments and
future SaaS wrappers should configure it through `HASNA_TODOS_*` variables and
provide the matching Postgres/S3 clients through the public `./storage` package
export.

## The data-backend switch

There is no deployment-mode axis. One switch selects where data lives, with
exactly two arms on each side of the HTTP boundary:

- **Client (CLI/MCP/TUI)** — `sqlite` (the on-box file, reachable only under
  the explicit local opt-in `HASNA_TODOS_LOCAL=1` / `TODOS_LOCAL=1`) or `http`
  (the authenticated Todos `/v1` authority). The client never opens Postgres
  directly.
- **Server (`todos-serve`) / native storage tooling** — `sqlite` (no database
  URL configured) or `postgres` (a `HASNA_TODOS_DATABASE_URL` is present).

`HASNA_TODOS_API_URL` + `HASNA_TODOS_API_KEY` select the authenticated HTTP
authority (client). `HASNA_TODOS_DATABASE_URL` selects the Postgres backend
(server/native storage tooling). The storage-mode variables
(`HASNA_TODOS_STORAGE_MODE` and their aliases) are RETIRED: their mere presence
is a hard error (owner directive 2026-08-15), and no deployment-mode token is
accepted. No third arm exists.

Legacy hosted API toggles are not storage selectors. They cannot select the
local store and cannot rescue a run that lacks both the API pair and the local
opt-in.

## CLI Remote HTTP Authority

The open CLI remote route uses only these canonical settings:

| Setting | Purpose |
| --- | --- |
| `HASNA_TODOS_API_URL` | Todos authority root, the same root ending in `/v1`, or the fleet gateway form `https://api.hasna.com/todos[/v1]`. |
| `HASNA_TODOS_API_KEY` | API key supplied to the authority as a bearer credential. |

Both must be set to select the HTTP authority. URL set without KEY (or KEY set
without URL) is a hard error naming the missing variable — the CLI never falls
back to the on-box SQLite store from a partial cloud configuration. With
NEITHER set, the CLI fails closed (non-zero exit, error naming both variables
and the opt-in) unless `HASNA_TODOS_LOCAL=1` (alias `TODOS_LOCAL=1`) explicitly
opts into local SQLite mode. There is no default local mode and no
`todos-local-fallback` notice path: a false-green rc 0 against the on-box store
is impossible (the incident 715712 response was tightened by the ruling).

The URL must use HTTPS, except for loopback development authorities. Userinfo,
query strings, fragments, redirects, `/api/v1`, and other non-`<app>[//v1]`
paths are rejected. The gateway form `https://api.hasna.com/<app>` is accepted
and `/v1` is appended (the gateway strips the `<app>` segment and forwards to
the `https://<app>.hasna.xyz` origin); `<app>/v1` is used verbatim. The CLI
does not infer an authority from `TODOS_URL`, does not use a private SaaS
route, and does not send the bearer credential across redirects.

Remote selection is fail-closed. A missing URL or key, conflicting mode
selectors, an incompatible collection route, authentication failure, timeout,
or server failure is reported with a `REMOTE_*` diagnostic before local SQLite
can open. A resource-level 404 remains a normal not-found result. There is no
SQLite or Postgres fallback for a remote CLI invocation.

The supported coordination surface includes storage/status diagnostics,
projects, task lists, project-scoped plans, task create/upsert/list/show/update,
task-list and plan moves, comments, start/complete/delete, and next/claim. A
command without a safe `/v1` equivalent exits with `REMOTE_COMMAND_UNSUPPORTED`
before local helpers run.

`todos storage status --json` is a configuration-only diagnostic. On the http
transport it reports the redacted `/v1` base, URL/key presence, HTTP transport, and
the disabled local fallback without opening a database or making a network
request. `todos health` and `todos doctor` authenticate against the required
remote routes.

`todos doctor` additionally audits REFERENTIAL INTEGRITY against the authority
and its exit code is a verdict, not a "the call succeeded" flag: `0` clean, `1`
findings (orphaned or dangling project / task-list references), `2` incomplete
(a condition could not be measured, so health was not established). It prefers
the server-side aggregate `GET /v1/integrity`, which the storage adapter computes
with one SQL COUNT per condition on Postgres and SQLite alike; an authority that
does not expose it leaves the task-level conditions `NOT CHECKED` unless
`--scan-tasks` completes a read-only paged walk of `/v1/tasks`. Findings are
report-only — `doctor --apply` remains refused outright in remote mode and never
repairs an integrity finding in any mode.

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
`HASNA_` prefix, for example `TODOS_DATABASE_URL`, and
`TODOS_S3_BUCKET`. Public docs and wrappers should still prefer the canonical
`HASNA_TODOS_*` names.

Production secrets should follow a consistent namespaced convention, for
example:

- `<org>/<division>/<app>/<env>/env`
- `<org>/<division>/<app>/<env>/rds`
- `<org>/<division>/<app>/<env>/s3`

Deployment-specific infrastructure identifiers — the managed Postgres cluster
name and the secrets-manager path that holds the runtime database URL — are
owned by the private hosting wrapper and supplied at runtime via the optional
`HASNA_TODOS_RDS_CLUSTER` and `HASNA_TODOS_RDS_RUNTIME_PATH` environment
variables; this open package ships no real cluster names or secrets-manager
paths. Runtime wiring should set `HASNA_TODOS_DATABASE_URL` from the resolved
secret. `TODOS_DATABASE_URL` is only a plain fallback for local development or
wrappers that have not yet migrated.

A SaaS wrapper owns tenant state, billing, accounts, deployment, observability,
and production secret wiring. The open package owns local storage, the public
storage contract, local tests, and explicit remote adapter interfaces.

## Public Adapter Exports

The public `@hasna/todos/storage` export now includes:

- `loadTodosStorageConfig` and `createTodosStorageAdapter` for backend selection.
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
  local artifact metadata rows as the source of truth. Objects are
  content-addressed under `artifacts/<task_id>/<sha256>` inside the configured
  bucket prefix.
- `uploadRunArtifactAtCreation` for the creation-time hop: when
  `HASNA_TODOS_S3_BUCKET` (or the `TODOS_S3_BUCKET` fallback) is set, the CLI
  `runs artifact` command, the MCP `add_task_run_artifact` tool, and the
  environment-snapshot flows upload the stored bytes to S3 right after the
  artifact row is created and record the remote reference on its metadata, so
  `todos storage artifacts download` restores the bytes on any machine. The
  hop is fail-soft: without a bucket or with missing credentials the artifact
  stays local-only and creation never fails.

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

## Hybrid Sync Shape (explicit migration machinery)

`createHybridTodosStorageAdapter` builds a local-plus-remote adapter when the
caller passes a Postgres-style query client or sync store. It is migration/sync
machinery invoked explicitly — it is NOT an arm of the data-backend switch, and
no environment value selects it:

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

## Postgres CRUD Shape

A present `HASNA_TODOS_DATABASE_URL` builds a pure Postgres adapter when the
caller passes a Postgres-style query client to
`createTodosStorageAdapter`:

- CRUD uses the repo-owned `todos_sync_records` JSONB table rather than SaaS
  tenant tables.
- The package does not import `pg`; wrappers or internal deployments provide
  the connected client.
- `createPostgresTodosStorageAdapter` is also exported directly for callers
  that want to bypass backend selection.
- Local SQLite remains the default unless `HASNA_TODOS_DATABASE_URL` is set
  explicitly (with the one carve-out that a shadow mirror
  `HASNA_TODOS_SHADOW=1` keeps SQLite as the source of truth).

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
