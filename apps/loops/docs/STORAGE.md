# Loops Storage

Loops supports one active source of truth at a time. The public package
defines the storage vocabulary, local cache behavior, API shape, and runner
contract. Hosted multi-tenant operation is implemented outside this public
package.

There is ONE data-backend axis and two seams — there is no deployment-mode
axis. "Where does Loops run" is an operations question; the package only
answers "which store is authoritative":

- **Client store seam** (`loops` CLI / MCP / SDK): `sqlite | http`. The client
  reads the on-box SQLite file, or the server's HTTP `/v1` API. It never opens
  Postgres directly.
- **Server data backend** (`loops-serve` / `loops-daemon`): `sqlite | postgres`.
  The on-box daemon schedules from SQLite; `loops-serve` runs against the
  Postgres database selected by `HASNA_LOOPS_DATABASE_URL`.

Storage is a runtime concern, not the automation product surface — specs,
queues, approvals, and audit for product automations remain in
`@hasna/automations` and `@hasna/actions`. See
[Runtime Boundary](./RUNTIME_BOUNDARY.md).

## The two seams

| Seam | Values | Selected by | Executor |
| --- | --- | --- | --- |
| Client store | `sqlite` (default) | nothing set, or `HASNA_LOOPS_STORAGE_MODE=sqlite` pin | `loops-daemon` |
| Client store | `http` | `HASNA_LOOPS_API_URL` + `HASNA_LOOPS_API_KEY` | `loops-runner` foundation |
| Server backend | `sqlite` (daemon) | default | `loops-daemon` |
| Server backend | `postgres` (`loops-serve`) | `HASNA_LOOPS_DATABASE_URL` | `loops-runner` foundation |

The on-box sqlite store remains the default. It must keep working without
network access, tokens, Postgres, or hosted infrastructure.

The server side is `loops-serve`: the control-plane deployment served against
operator-owned Postgres. The public `@hasna/loops` package owns `loops-serve`,
the embeddable `loops-api` contract, the Postgres storage adapter, migrations,
HTTP SDK, and runner contract. Account provisioning and hosted infrastructure
stay outside this package; the public package must not depend on private hosted
packages or resource names.

## Resolution

`HASNA_LOOPS_STORAGE_MODE` may be set to `sqlite` or `http` and pins the
client store seam. `sqlite` forces the on-box file even when the API vars are
present — the reversible escape hatch. `http` requires both API vars and fails
closed without them. Other spellings are rejected.

The retired deployment-mode values (`local`, `self_hosted`, `cloud`) are still
accepted from the environment and map onto the backend they always selected
(`local` → `sqlite`; `self_hosted`/`cloud` → `http`). They are aliases only:
they never appear in any output.

When no explicit pin is set, Loops resolves from configuration:

1. `HASNA_LOOPS_API_URL` (with `HASNA_LOOPS_API_KEY`) selects the http client
   transport; either the API URL or `HASNA_LOOPS_DATABASE_URL` hands scheduler
   authority to the server contract.
2. Otherwise the on-box sqlite store is authoritative.

Tokens are represented only as presence signals in status output. URL
credentials, query strings, and fragments are not returned in status output.

## Commands

```bash
loops mode
loops --json mode
loops server status
loops server migrate --dry-run
loops server push --dry-run
loops server pull --dry-run
loops-api status
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

`loops self-hosted …` and `loops cloud …` remain as hidden aliases of
`loops server …` for existing automation; they print the same status.

Human status output is intentionally compact:

```text
backend=sqlite client=sqlite authority=local_sqlite source=default local=authoritative scheduler=local_sqlite server=false
```

JSON uses these field names:

- `dataBackend`: this process's server-side data backend — `postgres` iff
  `HASNA_LOOPS_DATABASE_URL` is set, else `sqlite`.
- `clientTransport`: the client store seam — `http` when the API URL and key
  are configured, else `sqlite`.
- `authority`: `local_sqlite` or `server_api` — which store is authoritative
  for loop data on this machine.
- `authoritySource`: the env var or default that selected the authority.
- `localStore.role`: `authoritative` when the on-box store is authoritative,
  `cache_and_spool` when the server is.
- `server.configured`: true when the API URL or database URL is present.
- `server.apiUrl`: a display-safe URL without credentials, query string,
  or fragment.
- `schedulerState.localStore`: always names the local SQLite store and local
  run artifact files. Authoritative or cache/spool per `authority`.
- `schedulerState.remoteStore`: names the server scheduler contract:
  `api_control_plane_contract`, `postgres_contract`, `unconfigured`, or
  `none`. The standalone CLI never mutates Postgres directly; remote apply
  goes through the configured control-plane API import contract. `loops-serve`
  itself wires the Postgres storage adapter for normal control-plane CRUD,
  id-preserving import, and runner protocol routes.
- `schedulerState.remoteStore.objectArtifacts`: `object_store_contract` means
  remote artifact/object storage is a control-plane contract. The public package
  does not create or mutate S3 buckets, AWS resources, or hosted credentials.
- `schedulerState.routeAdmission`: names the active route-state store and the
  bounded gates (`max_dispatch`, `max_active`, `max_active_per_project`,
  `max_active_per_project_group`, `max_active_scope`, and `max_per_profile`).
  Live active counts use admitted/running work items; dry-runs do not open or
  migrate the live store to compute counts.

`loops-serve` is the Postgres-backed HTTP control-plane binary in this public
package. It reads and writes Postgres directly, serves open foundation probes
(`GET /health`, `/ready`, `/version`, `/openapi.json`), gates `/v1` loop/run and
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
It is source-only infrastructure glue for server deployments that use an
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

`loops-api` is the embeddable API contract in the same public package. It is not
a separate service because every server operator and the hosted service must
share the same public contract. `loops-serve` is the only shipped
Postgres-backed host.

`loops-runner` is the process that connects a machine to a server control
plane. The current public package supports a bounded one-shot protocol:
claim polling, claim-token fenced lease heartbeat/finalization, and
`loops-runner run-once` execution for command, agent, and workflow targets.
Workflow execution uses runner-scoped workflow and goal APIs behind the claimed
run lease. Durable machine registration, full fleet daemon mode, and
always-on fleet observability still need follow-up releases before
`loops-runner` is advertised as a complete always-on worker.

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

`loops server push` applies an additional server-side safety rule. Imported
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

Server sync commands use the control-plane API:

```bash
loops server migrate --dry-run
loops server push --dry-run
loops server push --apply
loops server pull --dry-run
```

They inspect local state, inspect `HASNA_LOOPS_API_URL` when configured, and
report the rows that would move. `loops server push --apply` sends the
id-preserving workflow and loop import bundle to `/v1/import`; imported
workflows are archived and imported loops are paused with run pointers cleared.
Local SQLite remains authoritative until an operator applies the import and
records the rollout evidence; when the server is authoritative it may remain a
cache, offline spool, and audit copy.

`HASNA_LOOPS_DATABASE_URL` selects the server's Postgres
scheduler-state contract and is required by `loops-serve`. It does not
make the standalone `loops` CLI mutate a remote database by itself. Remote
execution still flows through a configured control-plane API and runner
protocol. `loops-runner` needs `HASNA_LOOPS_API_URL` to claim
work; a database URL alone is migration/readiness configuration.

Cross-machine rollout evidence should record: machine id/hostname, package
version, git/build version, command run, dry-run or apply mode, redacted API
URL, source and target store ids, backup path, bundle hash, schema version,
row counts, conflicts, blocked rows, runner machine record id, daemon/runner
status, and timestamp.

## Machine Placement

A loop can eventually target:

- one specific machine,
- a machine pool selected by capability labels,
- or multiple machines intentionally.

Single-run loops need a lease so only one runner executes each scheduled slot.
Multi-machine loops must record per-machine run evidence so duplicate work is
distinguishable from intentional fan-out.

This is separate from existing local OpenMachines dispatch. When the on-box
store is authoritative, `loops-daemon` can still dispatch a loop target to a
configured remote machine through the existing OpenMachines transport. When the
server is authoritative, machine execution is runner-pull: `loops-runner`
claims work from the control plane. Operators should not conflate local remote
dispatch with the server runner protocol.

## Follow-Up Work

Server-side execution needs these follow-up releases before it is complete:

- Long-running runner daemon mode with backoff, fleet observability, and
  durable machine registration records.
- Id-preserving server import coverage for run history, workflow history,
  work items, goals, and audit rows.
- Hosted product integration outside the public package.

## Public Package Boundary

The public package owns:

- local SQLite scheduling and daemon execution,
- the storage resolver and status surfaces,
- the server API contract,
- the runner contract,
- local cache/spool semantics,
- import/export and migration commands,
- SDK, MCP, and CLI primitives.

Hosted product code owns:

- tenant account management,
- hosted authentication and invitations,
- hosted observability and admin operations,
- cloud infrastructure deployment,
- product UI and customer lifecycle flows.

The public package must document hosted behavior as a contract unless a hosted
URL and token are explicitly configured. It must not claim that a hosted
service is live by default.
