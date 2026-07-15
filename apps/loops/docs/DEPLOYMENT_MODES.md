# OpenLoops Deployment Modes

OpenLoops supports one active source of truth at a time. The public package
defines the mode vocabulary, local cache behavior, API shape, and runner
contract. Hosted multi-tenant operation is implemented outside this public
package.

Deployment modes describe **where the OpenLoops runtime stores and executes**
loops and workflows (`local` SQLite, `self_hosted` control plane, or `cloud`
contract). They are runtime placement concerns, not the automation product
surface — specs, queues, approvals, and audit for product automations remain in
`@hasna/automations` and `@hasna/actions`. See
[Runtime Boundary](./RUNTIME_BOUNDARY.md).

## Modes

| Mode | Source of truth | Local storage role | Executor |
| --- | --- | --- | --- |
| `local` | SQLite in `LOOPS_DATA_DIR` | Authoritative | `loops-daemon` |
| `self_hosted` | Hasna-owned AWS/RDS control plane served by `loops-serve`/`loops-api` | Cache and offline spool | `loops-runner` foundation |
| `cloud` | A configured hosted control plane contract | Cache and offline spool | `loops-runner` foundation |

`local` remains the default. It must keep working without network access,
tokens, Postgres, or hosted infrastructure.

`self_hosted` is the Hasna-owned AWS/RDS control-plane deployment. The public
`@hasna/loops` package owns `loops-serve`, the embeddable `loops-api` contract,
the Postgres storage adapter, migrations, HTTP SDK, and runner contract for this
mode.

`cloud` is the hosted control-plane contract. The public package exposes the
client and runner contract, tenant authentication, and tenant isolation; account
provisioning and hosted infrastructure stay outside this package. The public package must not depend on
private hosted packages or resource names. This release exposes status
surfaces only.

## Mode Resolution

`HASNA_LOOPS_STORAGE_MODE` may be set to `local`, `self_hosted`, or
`cloud`. Other spellings and legacy mode names are rejected.

When no explicit mode is set, OpenLoops resolves the mode from configuration:

1. `HASNA_LOOPS_API_URL` or
   `HASNA_LOOPS_DATABASE_URL` selects `self_hosted`.
2. Otherwise OpenLoops uses `local`.

Both non-local modes use the canonical `HASNA_LOOPS_API_URL`; an explicit
`HASNA_LOOPS_STORAGE_MODE=cloud` distinguishes hosted cloud from self-hosted.

Tokens are represented only as presence signals in status output. Self-hosted
status uses `HASNA_LOOPS_API_KEY`. Cloud status uses
`HASNA_LOOPS_API_KEY`. URL credentials, query
strings, and fragments are not returned in status output.

## Commands

```bash
loops mode
loops --json mode
loops self-hosted status
loops self-hosted migrate --dry-run
loops self-hosted push --dry-run
loops self-hosted pull --dry-run
loops cloud status
loops-api status
loops-serve version
HASNA_LOOPS_MIGRATOR_DATABASE_URL=... loops-serve migrate --dry-run
HASNA_LOOPS_DATABASE_URL=... HASNA_LOOPS_AUTH_DATABASE_URL=... loops-serve serve
loops-runner status
loops export --file ./loops-export.json --dry-run
loops export --file ./loops-export.json
loops import ./loops-export.json
loops import ./loops-export.json --apply
```

Human status output is intentionally compact:

```text
deploymentMode=local active source=default truth=local_sqlite local=authoritative scheduler=local_sqlite control_plane=none
```

JSON uses these field names:

- `deploymentMode`: the requested status perspective.
- `activeDeploymentMode`: the mode selected from the current environment.
- `deploymentModeSource`: the env var or default that selected the active mode.
- `sourceOfTruth`: `local_sqlite`, `self_hosted_control_plane`, or
  `cloud_control_plane`.
- `localStore.role`: `authoritative` in local mode, `cache_and_spool` in
  non-local modes.
- `controlPlane.configured`: true only when the current mode has enough
  configuration to be usable. Cloud requires both the canonical API URL and a token
  presence signal.
- `controlPlane.apiUrl`: a display-safe URL without credentials, query string,
  or fragment.
- `schedulerState.localStore`: always names the local SQLite store and local
  run artifact files. In `local` mode this store is authoritative; in
  non-local modes it is a cache, offline spool, and audit copy.
- `schedulerState.remoteStore`: names the non-local scheduler contract:
  `api_control_plane_contract`, `postgres_contract`,
  `hosted_control_plane_contract`, `unconfigured`, or `none`. Remote apply is
  `false` in the standalone CLI until the control-plane API exposes
  id-preserving import endpoints. `loops-serve` itself wires the Postgres
  storage adapter for normal control-plane CRUD and runner protocol routes.
- `schedulerState.remoteStore.objectArtifacts`: `object_store_contract` means
  remote artifact/object storage is a control-plane contract. The public package
  does not create or mutate S3 buckets, AWS resources, or hosted credentials.
- `schedulerState.routeAdmission`: names the active route-state store and the
  bounded gates (`max_dispatch`, `max_active`, `max_active_per_project`,
  `max_active_per_project_group`, `max_active_scope`, and `max_per_profile`).
  Live active counts use admitted/running work items; dry-runs do not open or
  migrate the live store to compute counts.

`loops-serve` is the self-hosted HTTP control-plane binary in this public
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

`loops-api` is the embeddable API contract in the same public package. It is not
a separate service because self-hosted users and the hosted service must share
the same public contract. `loops-serve` is the only shipped Postgres-backed
self-hosted host.

`loops-runner` is the process that connects a machine to a non-local control
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

`loops self-hosted push` applies an additional self-hosted safety rule. Imported
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

Self-hosted sync commands are preview-only today:

```bash
loops self-hosted migrate --dry-run
loops self-hosted push --dry-run
loops self-hosted pull --dry-run
```

They inspect local state, optionally inspect `HASNA_LOOPS_API_URL`, and report the
rows that would need to move. Remote apply is intentionally blocked because the
current self-hosted API exposes normal loop CRUD and run listing, not
id-preserving workflow/loop/run import endpoints. A normal remote loop create
would generate new ids, so it is not a no-loss migration. Local SQLite remains
authoritative until a safe import is applied; in non-local modes it may remain
a cache, offline spool, and audit copy.

`HASNA_LOOPS_DATABASE_URL` selects the self-hosted
Postgres scheduler-state contract and is required by `loops-serve`. It does not
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

This is separate from existing local OpenMachines dispatch. In `local` mode,
`loops-daemon` can still dispatch a loop target to a configured remote machine
through the existing OpenMachines transport. In `self_hosted` or `cloud`,
machine execution is runner-pull: `loops-runner` claims work from
the control plane. Operators should not treat local remote dispatch as cloud
mode.

## Follow-Up Work

Non-local execution needs these follow-up releases before it is complete:

- Long-running runner daemon mode with backoff, fleet observability, and
  durable machine registration records.
- Workflow target execution over the remote protocol.
- Id-preserving self-hosted import endpoints for workflow specs, loop
  definitions, run history, workflow history, work items, goals, and audit rows.
- Hosted product integration outside the public package.

## Public Package Boundary

The public package owns:

- local SQLite scheduling and daemon execution,
- the mode resolver and status surfaces,
- the self-hosted API contract,
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

The public package must document cloud behavior as a contract unless a hosted
URL and token are explicitly configured. It must not claim that cloud service is
live by default.
