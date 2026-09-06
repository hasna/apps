# Loops Storage Backends And Client Connections

Loops supports one active source of truth at a time. There are no deployment
modes: the only server-side switch is the storage backend, and clients connect
either to the local file or to a control-plane HTTP API. Hosted multi-tenant
operation is implemented outside this public package.

Storage backends and client connections describe **where the Loops runtime
stores and executes** loops and workflows (a SQLite file, or a control-plane API
over PostgreSQL). They are runtime placement concerns, not the automation
product surface — specs, queues, approvals, and audit for product automations
remain in `@hasna/automations` and `@hasna/actions`. See
[Runtime Boundary](./RUNTIME_BOUNDARY.md).

## Storage Backends

The server-side storage backend is selected by configuration, never by a mode
enum:

| Backend | Selection | Notes |
| --- | --- | --- |
| `sqlite` | Default. Local file at the effective Loops data home — `~/.hasna/loops/loops.db` by default, resolved through `@hasna/paths` to the XDG data home once the store is migrated there or `HASNA_DATA_HOME` is set, or `$LOOPS_DATA_DIR/loops.db` when `LOOPS_DATA_DIR` is set | Zero-configuration on-box default; `loops` and `loops-daemon` use it |
| `postgresql` | `HASNA_LOOPS_DATABASE_URL` on `loops-serve` | The control-plane server's store |

`sqlite` is the default. It must keep working without network access, tokens,
Postgres, or hosted infrastructure.

The public `@hasna/loops` package owns `loops-serve`, the embeddable `loops-api`
contract, the Postgres storage adapter, migrations, HTTP SDK, and runner
contract for a Postgres-backed control plane. Account provisioning and hosted
infrastructure stay outside this package; the public package must not depend on
private hosted packages or resource names.

## Client Connections

The client (CLI, SDK, MCP) has exactly two connections:

| Connection | Selection | Notes |
| --- | --- | --- |
| `file` | `HASNA_LOOPS_CONNECTION=file` (explicit opt-in) | The local SQLite file; authoritative local scheduling and daemon execution. Announces itself ("local mode") on stderr |
| `api` | The shared credential resolver (`@hasna/contracts` 1.0.2): macOS Keychain items `hasna.credentials.loops.api-key` / `.api-url` (account `HASNA_STATION`, else short hostname, else `USER`), then `~/.hasna/loops/config/credentials` (0600; `HASNA_HOME` / `HASNA_CONFIG_HOME` relocate it, XDG is never consulted), then `HASNA_LOOPS_API_KEY` in the environment; authority defaults to the fleet gateway `https://api.hasna.com/loops` once a credential resolves | The control-plane HTTP API at `<authority>/v1` with a bearer key |

No connection is a default. A credential from any tier flips the client to the
control-plane API; the on-box file store requires the explicit
`HASNA_LOOPS_CONNECTION=file` opt-in. An invocation with no credential and no
explicit selection FAILS CLOSED: non-zero exit with an actionable error naming
what is missing — the client never silently serves the local SQLite file. A
configured environment outranks the opt-in (and a half-configured one fails
loudly instead of downgrading). The `HASNA_LOOPS_CONNECTION=api` value is
retired — the resolver selects the hosted connection — and any other value is
a hard error. There is no mode variable in this decision. A database URL never
changes client authority: the standalone `loops` CLI never mutates a remote
database by itself, and remote execution flows through the configured
control-plane API and runner protocol.

Tokens are represented only as presence signals in status output. URL
credentials, query strings, and fragments are not returned in status output.
The resolver re-reads the Keychain and the credential file on every call, so a
rotation heals a long-lived MCP server or SDK client without a restart, and a
station needs no inline env prefix.

## Status Report

`loops status` reports the storage backend and the client connection. Human
status output is intentionally compact; JSON uses these field names:

- `storage`: the server-side storage backend, `sqlite` or `postgresql`.
- `connection`: the client connection, `file` or `api`.
- `connectionSource`: the env var that selected the connection (`HASNA_LOOPS_CONNECTION` or the API variables); there is no unset default.
- `localStore.role`: `authoritative` on the file connection, `spool`
  on the API connection.
- `controlPlane.configured`: true only when the API connection has enough
  configuration to be usable: both the API URL and a token presence signal.
- `controlPlane.apiUrl`: a display-safe URL without credentials, query string,
  or fragment.
- `schedulerState.localStore`: always names the local SQLite store and local
  run artifact files. On the file connection this store is authoritative; on
  the API connection it is a cache, offline spool, and audit copy.
- `schedulerState.remoteStore`: names the configured control-plane contract:
  `api_control_plane_contract`, `postgres_contract`,
  `hosted_control_plane_contract`, `unconfigured`, or `none`. The standalone
  CLI never mutates Postgres directly; control-plane apply goes through the
  configured control-plane API import contract. `loops-serve` itself wires the
  Postgres storage adapter for normal control-plane CRUD, id-preserving import,
  and runner protocol routes.
- `schedulerState.remoteStore.objectArtifacts`: `object_store_contract` means
  remote artifact/object storage is a control-plane contract. The public package
  does not create or mutate S3 buckets, AWS resources, or hosted credentials.
- `schedulerState.routeAdmission`: names the active route-state store and the
  bounded gates (`max_dispatch`, `max_active`, `max_active_per_project`,
  `max_active_per_project_group`, `max_active_scope`, and `max_per_profile`).
  Live active counts use admitted/running work items; dry-runs do not open or
  migrate the live store to compute counts.

## Commands

```bash
loops status
loops --json status
loops migrate --dry-run
loops push --dry-run
loops pull --dry-run
loops-serve version
HASNA_LOOPS_MIGRATOR_DATABASE_URL=... loops-serve migrate --dry-run
loops-serve db-credentials reconcile
HASNA_LOOPS_DATABASE_URL=... HASNA_LOOPS_AUTH_DATABASE_URL=... loops-serve serve
loops-runner status
loops export --file ./loops-export.json --dry-run
loops export --file ./loops-export.json
loops import ./loops-export.json
loops import ./loops-export.json --apply
```

`loops-serve` is the control-plane HTTP server binary in this public package.
It reads and writes Postgres directly, serves open foundation probes (`GET
/health`, `/ready`, `/version`, `/openapi.json`), gates `/v1` loop/run and
runner-protocol routes with API-key auth on non-local binds, and applies the
Postgres migrations, including the tenant-bound `api_keys` table, with the
prepare/backfill/enforce `loops-serve migrate` sequence.

The service requires separate database logins: `HASNA_LOOPS_DATABASE_URL` is
the tenant-scoped runtime role, while `HASNA_LOOPS_AUTH_DATABASE_URL` is the
authenticator-only role that can verify keys and append authentication audits.
`HASNA_LOOPS_MIGRATOR_DATABASE_URL` is an offline schema-administrator login;
tenant enforcement normalizes cluster role attributes and therefore requires
the PostgreSQL privilege to alter role security attributes.

The in-cluster credential reconciler is `loops-serve db-credentials reconcile`.
It is source-only infrastructure glue for self-hosted deployments that use an
RDS-managed master secret and separate app DSN secrets. The command must run
with the ECS task role (`AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`) and AWS
Secrets Manager access to exactly four distinct same-region secret ARNs. It
rejects static AWS credentials, profiles, web-identity inputs, full credential
URIs, malformed secret ARNs, duplicate app secrets, endpoint mismatches, and
master-secret JSON that does not exactly match the expected RDS instance id,
endpoint, port, database, and master username.

The reconciler never prints or stores raw passwords outside Secrets Manager and
Postgres. For every app secret it writes an `AWSPENDING` DSN, changes that
login password inside a database transaction, tests a fresh verify-full
connection, then promotes the pending version to `AWSCURRENT`. If the current
secret/password pair is already valid, it leaves the secret untouched. Before
migration `0010_tenant_enforce`, runtime and authenticator logins are kept
detached from service roles; after `0010`, each is attached only to its exact
matching NOLOGIN role.

`@hasna/loops/api` is the embeddable API contract in the same public package.
It is not a separate service because self-hosted users and the hosted service
must share the same public contract. The former `loops-api` PATH binary is not
published; use `loops status` for operator status and `loops-serve`
for the Postgres-backed control-plane host.

`loops-runner` is the process that connects a machine to a control plane. The
current public package supports a bounded one-shot protocol: claim polling,
claim-token fenced lease heartbeat/finalization, and `loops-runner run-once`
execution for command, agent, and workflow targets. Workflow execution uses
runner-scoped workflow and goal APIs behind the claimed run lease. Durable
machine registration, full fleet daemon mode, and always-on fleet observability
still need follow-up releases before `loops-runner` is advertised as a complete
always-on worker.

## Migration And Sync

Local migration commands are available now:

```bash
loops export --file ./loops-export.json
loops export --file ./loops-export.json --dry-run
loops import ./loops-export.json
loops import ./loops-export.json --apply
```

`loops export` writes an id-preserving JSON bundle for the supported local
state: workflow specs, loop definitions, and terminal loop run history. The
bundle includes schema version, package version, row counts, row hashes, and
no-loss checks. Use `--dry-run` to preview the bundle without writing a file.
Inline command `env` values are treated as unsafe for export; the command
refuses to write a no-loss bundle unless the operator explicitly uses
`--allow-redacted`, which produces a non-importable redacted bundle.

`loops import` is a dry-run by default. It reports exact per-row actions:
`insert`, `update`, `skip`, `conflict`, and `blocked`. Applying an import
requires `--apply`; existing rows with the same id are updated only with
`--replace`. The CLI creates a local SQLite backup before a safe apply.

`loops push` applies an additional safety rule. Imported
workflow definitions are archived, and imported loops are paused with
`nextRunAt`/`retryScheduledFor` cleared. That safety normalization can re-archive
or re-pause existing same-id rows even when `--replace` is not supplied; explicit
preserve flags are reserved for deliberate activation.

No-loss validation blocks unsupported or live state instead of silently
dropping it. The current migration bundle does not preserve workflow invocation
rows, workflow work items, workflow run/step/event history, or goal run history.
If those tables contain rows, the export/import plan is non-importable until a
later release adds full table-preserving migration. Active daemon leases,
running loop runs, running workflow runs/steps, and leased work items also
block migration; finish or stop that work first.

Control-plane sync commands use the control-plane API:

```bash
loops migrate --dry-run
loops push --dry-run
loops push --apply
loops pull --dry-run
```

They inspect local state, inspect `HASNA_LOOPS_API_URL` when configured, and
report the rows that would move. `loops push --apply` sends the
id-preserving workflow and loop import bundle to `/v1/import`; imported
workflows are archived and imported loops are paused with run pointers cleared.
Local SQLite remains authoritative until an operator applies the import and
records the rollout evidence; on the API connection it may remain a cache,
offline spool, and audit copy.

`HASNA_LOOPS_DATABASE_URL` selects the Postgres storage backend and is required
by `loops-serve`. It does not make the standalone `loops` CLI mutate a remote
database by itself. Remote execution still flows through a configured
control-plane API and runner protocol. `loops-runner` needs
`HASNA_LOOPS_API_URL` to claim work; a database URL alone is
migration/readiness configuration.

Cross-machine rollout evidence should record: machine id/hostname, package
version, git/build version, command run, dry-run or apply mode, redacted API
URL, source and target store ids, backup path, bundle hash, schema version,
row counts, conflicts, blocked rows, runner machine record id, daemon/runner
status, and timestamp.

## Transition Note

Reverting a flipped client is exactly removing the machine's loops credential
(unset `HASNA_LOOPS_API_KEY`, delete the Keychain item
`hasna.credentials.loops.api-key` and the credential file
`~/.hasna/loops/config/credentials`); the local file connection remains
available only through the explicit `HASNA_LOOPS_CONNECTION=file` opt-in. The
former `HASNA_LOOPS_STORAGE_MODE` variable and the `HASNA_LOOPS_CONNECTION=api`
value are deleted; there is no mode value to flip back.

## Machine Placement

A loop can eventually target:

- one specific machine,
- a machine pool selected by capability labels,
- or multiple machines intentionally.

Single-run loops need a lease so only one runner executes each scheduled slot.
Multi-machine loops must record per-machine run evidence so duplicate work is
distinguishable from intentional fan-out.

This is separate from existing local OpenMachines dispatch. On the file
connection, `loops-daemon` can still dispatch a loop target to a configured
remote machine through the existing OpenMachines transport. On the API
connection, machine execution is runner-pull: `loops-runner` claims work from
the control plane. Operators should not treat local remote dispatch as a
control-plane connection.

## Follow-Up Work

Control-plane execution needs these follow-up releases before it is complete:

- Long-running runner daemon mode with backoff, fleet observability, and
  durable machine registration records.
- Id-preserving import coverage for run history, workflow history,
  work items, goals, and audit rows.
- Hosted product integration outside the public package.

## Public Package Boundary

The public package owns:

- local SQLite scheduling and daemon execution,
- storage/connection resolution and status surfaces,
- the control-plane API contract,
- the runner contract,
- local cache/spool semantics,
- import/export and migration commands,
- SDK, MCP, and CLI primitives.

Hosted product code owns:

- tenant account management,
- hosted authentication and invitations,
- hosted observability and admin operations,
- hosted infrastructure deployment,
- product UI and customer lifecycle flows.

The public package must document hosted behavior as a contract unless a hosted
URL and token are explicitly configured. It must not claim that a hosted
service is live by default.

## Contracts Note

Until the in-flight `hasna/contracts` hotfix ships, the currently installed
contracts schema still REQUIRES `serviceSurfaces[].deploymentModes` on service
manifests, so a working `hasna.contract.json` must keep that field (dormant) or
it fails validation. Treat it as transitional: do not hand-strip it from
working manifests, and do not add mode vocabulary to new configuration. The
field is removed once the hotfix schema lands.
