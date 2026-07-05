# OpenLoops Deployment Modes

OpenLoops supports one active source of truth at a time. The public package
defines the mode vocabulary, local cache behavior, API shape, and runner
contract. Hosted multi-tenant operation is implemented outside this public
package.

## Modes

| Mode | Source of truth | Local storage role | Executor |
| --- | --- | --- | --- |
| `local` | SQLite in `LOOPS_DATA_DIR` | Authoritative | `loops-daemon` |
| `cloud` | AWS-backed hosted control plane | Cache and offline spool | `loops-runner` foundation |

`local` remains the default. It must keep working without network access,
tokens, Postgres, or hosted infrastructure.

`cloud` is the AWS-backed hosted control-plane contract. The public package
exposes the client and runner contract, but tenant auth, account administration,
and AWS infrastructure stay outside this package. The shared `@hasna/cloud`
runtime has been retired fleet-wide. The public package must not depend on
private hosted packages or resource names. This release exposes status surfaces
only.

## Mode Resolution

`LOOPS_MODE` or `HASNA_LOOPS_MODE` may be set to `local` or `cloud`.

When no explicit mode is set, OpenLoops resolves the mode from configuration:

1. `LOOPS_CLOUD_API_URL` or `HASNA_LOOPS_CLOUD_API_URL` selects `cloud`.
2. Otherwise OpenLoops uses `local`.

`cloud` uses `LOOPS_CLOUD_API_URL` or `HASNA_LOOPS_CLOUD_API_URL` plus
`LOOPS_CLOUD_TOKEN` or `HASNA_LOOPS_CLOUD_TOKEN`.

Tokens are represented only as presence signals in status output. Cloud status
uses `LOOPS_CLOUD_TOKEN` or `HASNA_LOOPS_CLOUD_TOKEN`. URL credentials, query
strings, and fragments are not returned in status output.

## Commands

```bash
loops mode
loops --json mode
loops self-hosted status
loops self-hosted migrate --dry-run
loops self-hosted push --dry-run
loops self-hosted pull --dry-run
loops self-hosted runner-register --runner-id <id> --machine-id <machine>
loops self-hosted runner-register --runner-id <id> --machine-id <machine> --apply
loops cloud status
loops-api status
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
- `sourceOfTruth`: `local_sqlite` or `cloud_control_plane`.
- `localStore.role`: `authoritative` in local mode, `cache_and_spool` in
  non-local modes.
- `controlPlane.configured`: true only when the current mode has enough
  configuration to be usable. Cloud requires both a cloud URL and a cloud token
  presence signal.
- `controlPlane.apiUrl`: a display-safe URL without credentials, query string,
  or fragment.
- `schedulerState.localStore`: always names the local SQLite store and local
  run artifact files. In `local` mode this store is authoritative; in
  non-local modes it is a cache, offline spool, and audit copy.
- `schedulerState.remoteStore`: names the remote scheduler contract:
  `api_control_plane_contract`, `postgres_contract`,
  `hosted_control_plane_contract`, `unconfigured`, or `none`. Remote apply is
  `false` in this public package until a control-plane host wires a full
  storage adapter.
- `schedulerState.remoteStore.objectArtifacts`: `object_store_contract` means
  remote artifact/object storage is a control-plane contract. The public package
  does not create or mutate S3 buckets, AWS resources, or hosted credentials.
- `schedulerState.routeAdmission`: names the active route-state store and the
  bounded gates (`max_dispatch`, `max_active`, `max_active_per_project`,
  `max_active_per_project_group`, `max_active_scope`, and `max_per_profile`).
  Live active counts use admitted/running work items; dry-runs do not open or
  migrate the live store to compute counts.

`loops-api` is a separate process in the same public package. It is not a
separate package at this stage because local operators and the AWS-hosted
service must share the same public contract. The API server can expose
storage-backed `/v1` loop CRUD and run listing when an embedding host injects
the public storage contract. The standalone `loops-api serve` binary still fails
closed for those routes until a control-plane storage adapter is wired by the
platform host.

`loops-runner` is the process that connects a machine to a non-local control
plane. The current public package supports a bounded one-shot protocol:
registration, claim polling, claim-token fenced heartbeat/finalization, and
`loops-runner run-once` execution for non-workflow targets. Full fleet daemon
mode and workflow target execution over the remote protocol still need
follow-up releases before `loops-runner` is advertised as a complete always-on
worker.

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

No-loss validation blocks unsupported or live state instead of silently
dropping it. The current migration bundle does not preserve workflow invocation
rows, workflow work items, workflow run/step/event history, or goal run history.
If those tables contain rows, the export/import plan is non-importable until a
later release adds full table-preserving migration. Active daemon leases,
running loop runs, running workflow runs/steps, and leased work items also
block migration; finish or stop that work first.

Cloud sync commands are preview-only today. The transitional `loops self-hosted
*` CLI surface still exists for compatibility while enums and adapters catch up;
treat it as the cloud control-plane preview path, not a third deployment mode:

```bash
loops self-hosted migrate --dry-run
loops self-hosted push --dry-run
loops self-hosted pull --dry-run
```

They inspect local state, optionally inspect the configured cloud control-plane
URL, and report the rows that would need to move. Remote apply is intentionally
blocked because the current control-plane API exposes normal loop CRUD and run
listing, not id-preserving workflow/loop/run import endpoints. A normal remote
loop create would generate new ids, so it is not a no-loss migration. Local
SQLite remains authoritative until a safe import is applied; in cloud mode it may
remain a cache, offline spool, and audit copy.

Remote execution flows through the configured AWS-backed control-plane API and
runner protocol. `loops-runner` needs a configured cloud API URL to claim work.

`loops self-hosted runner-register` is preview-only unless `--apply` is
present. The dry run prints the runner id, machine id, labels, and
capabilities that would be posted, without exposing tokens.

Cross-machine rollout evidence should record: machine id/hostname, package
version, git/build version, command run, dry-run or apply mode, redacted API
URL, source and target store ids, backup path, bundle hash, schema version,
row counts, conflicts, blocked rows, runner registration id, daemon/runner
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
through the existing OpenMachines transport. In `cloud` mode, machine execution
is runner-pull: a registered `loops-runner` claims work from the AWS-backed
control plane. Operators should not treat local remote dispatch as cloud mode.

## Follow-Up Work

Non-local execution needs these follow-up releases before it is live:

- A full Postgres control-plane adapter behind the public storage contract.
- Long-running runner daemon mode with backoff, fleet observability, and
  durable machine registration records.
- Workflow target execution over the remote protocol.
- Id-preserving cloud control-plane import endpoints for workflow specs, loop
  definitions, run history, workflow history, work items, goals, and audit rows.
- Hosted product integration outside the public package.

## Public Package Boundary

The public package owns:

- local SQLite scheduling and daemon execution,
- the mode resolver and status surfaces,
- the control-plane API contract,
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
