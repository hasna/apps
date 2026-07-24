# Native Storage Boundary

`@hasna/todos` stays local-first. A normal install uses local SQLite and local
artifact files without network access, hosted credentials, SaaS accounts, or a
shared cloud runtime package.

Runtime status: disabled in Stage A. Remote configuration values express
hosted intent, but no public Postgres, S3, hybrid, sync, or hosted-authority
adapter executes in this stage.

The tracked container configuration is containment-only and starts the help
surface rather than a listener. `/health` is reserved for process liveness;
`/ready` remains unavailable with 503 for hosted intent. Stage B defers RDS,
migration, and hosted runtime activation pending a new reviewed authority gate.

## Modes

- `HASNA_TODOS_STORAGE_MODE=local`: default local SQLite/file behavior.
- `HASNA_TODOS_STORAGE_MODE=remote`: declare hosted intent; Stage A fails
  closed before constructing an adapter or datastore client.
- `HASNA_TODOS_STORAGE_MODE=hybrid`: declare hosted intent; Stage A fails
  closed before local or remote datastore access.

Legacy hosted API toggles are not storage selectors. They must not change the
local CLI default.

## Stage A Hosted Authority Boundary

Remote and hybrid mode currently express hosted intent, but Stage A does not
contain a trusted positive authority resolver. Public CLI, SDK, MCP, server,
operator, and `/v1` datastore paths therefore fail closed before datastore or
request-body access:

- ordinary untrusted or missing authority returns typed `503`
  `HOSTED_AUTHORITY_UNAVAILABLE`;
- caller-forged authority headers or dedicated query claims return `400`
  `CALLER_AUTHORITY_REJECTED`;
- Stage A does not manufacture a `403` path. A trusted principal with zero
  grants belongs to the later Access/Orgs integration and can return `403` only
  after that trusted resolver exists.

Local mode remains the explicit SQLite path. The redacted `storage status` and
`storage sync-plan` diagnostics remain available without network or datastore
I/O; they do not confer hosted authority.

Status separates intent from capability: `remote_configured` may be `true`
when a remote mode or URL was supplied, while `remote_enabled` and
`runtime_enabled` are always `false` in Stage A. A sync plan is documentation,
not an executable migration, shadow, backfill, or cutover path.

The live `/v1` OpenAPI contract documents only the actual `400` forged-claim
and `503` unavailable-authority outcomes. It advertises no authenticated
success response. Trusted authority resolution belongs to a future stage.

## Future-positive contract (not live)

Positive request/response schemas and adapter types are retained for a later
authority-enabled stage and for forward design compatibility. They are not
served as the live OpenAPI document and do not enable remote execution. The
future stage must integrate a trusted authority resolver before those schemas
or adapters can become executable.

## Deferred Native AWS Configuration Vocabulary

The following names are reserved for future-positive integration and for
redacted diagnostics. Setting them in Stage A does not enable an adapter:

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

Plain fallback aliases are recognized with the same names minus the
`HASNA_` prefix, for example `TODOS_STORAGE_MODE`, `TODOS_DATABASE_URL`, and
`TODOS_S3_BUCKET`. They do not bypass the Stage A boundary.

If a future deployment enables this contract, production secret identifiers
are expected to follow the broader open package convention:

- `hasna/xyz/opensource/todos/prod/env`
- `hasna/xyz/opensource/todos/prod/rds`
- `hasna/xyz/opensource/todos/prod/s3`

The deferred production RDS design references the shared Hasna XYZ infra apps
Postgres cluster `hasna-xyz-infra-apps-prod-postgres`, database `todos`, and
runtime secret `hasna/xyz/opensource/todos/prod/rds`. Stage A does not load that
secret or connect to that target.

A SaaS wrapper owns tenant state, billing, accounts, deployment, observability,
and production secret wiring. The open package owns local storage, the public
storage contract, local tests, and deferred remote adapter type interfaces.

## Public Storage Exports in Stage A

The active public storage contract includes local configuration metadata and
SQLite snapshot helpers:

- `loadTodosStorageConfig` for mode inspection and redacted diagnostics.
- `STORAGE_TABLES`, `TODOS_STORAGE_ENV`, and `TODOS_STORAGE_FALLBACK_ENV` for
  wrapper provenance and explicit env mapping.
- `exportSqliteTodosStorageSnapshot` and `importSqliteTodosStorageSnapshot`
  for local SQLite state movement without a hosted service.

Remote and hybrid public names remain link-compatible Stage-A stubs. Their
function names, method names, and JavaScript arities match the prior public
surface, but every call throws the typed hosted-authority-unavailable error
before dependency, network, or datastore access. `createTodosStorageAdapter`
returns a local adapter only for explicit local mode and otherwise fails closed.

The open package does not bundle platform billing, tenant tables, deployment
code, or a cloud SDK. Future wrappers may provide clients and secret loading
only after trusted authority enablement.

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

## Deferred Hybrid Sync Shape

The future-positive hybrid design reserves local snapshot export/import,
remote push/pull, and pull-then-push synchronization. In Stage A,
`HASNA_TODOS_STORAGE_MODE=hybrid` selects containment, not this design, and the
stub rejects before inspecting a supplied query client or sync store.

## Deferred Remote CRUD Shape

The future-positive remote design reserves repo-owned JSONB sync records and a
caller-provided Postgres query client. In Stage A,
`HASNA_TODOS_STORAGE_MODE=remote` rejects before client or datastore access.

## Deferred S3 Artifact Sync

S3 artifact upload/download shapes are preserved for a future authority-enabled
stage. Their Stage-A public functions are non-networking stubs that reject
before reading credentials, local artifact rows, or object storage.

The CLI may report bounded, redacted, no-network previews. Any apply request is
denied in Stage A and cannot be converted into an S3 operation by supplying
configuration or caller authority claims.
