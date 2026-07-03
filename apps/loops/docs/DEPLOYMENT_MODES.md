# OpenLoops Deployment Modes

OpenLoops supports one active source of truth at a time. The public package
defines the mode vocabulary, local cache behavior, API shape, and runner
contract. Hosted multi-tenant operation is implemented outside this public
package.

## Modes

| Mode | Source of truth | Local storage role | Executor |
| --- | --- | --- | --- |
| `local` | SQLite in `LOOPS_DATA_DIR` | Authoritative | `loops-daemon` |
| `self_hosted` | A user-operated `loops-api` control plane contract | Cache and offline spool | `loops-runner` foundation |
| `cloud` | A configured hosted control plane contract | Cache and offline spool | `loops-runner` foundation |

`local` remains the default. It must keep working without network access,
tokens, Postgres, or hosted infrastructure.

`self_hosted` is for users or teams running their own control plane. The public
`@hasna/loops` package owns the API and runner contract for this mode.

`cloud` is the hosted control-plane contract. The public package exposes the
client and runner contract, but tenant auth, account administration, and hosted
infrastructure stay outside this package. The public package must not depend on
private hosted packages or resource names. This release exposes status
surfaces only; non-local claim/lease execution is follow-up work.

## Mode Resolution

`LOOPS_MODE` or `HASNA_LOOPS_MODE` may be set to `local`, `self_hosted`, or
`cloud`. Hyphenated `self-hosted` is normalized to `self_hosted`.

When no explicit mode is set, OpenLoops resolves the mode from configuration:

1. `LOOPS_CLOUD_API_URL` or `HASNA_LOOPS_CLOUD_API_URL` selects `cloud`.
2. `LOOPS_API_URL`, `HASNA_LOOPS_API_URL`, `LOOPS_DATABASE_URL`, or
   `HASNA_LOOPS_DATABASE_URL` selects `self_hosted`.
3. Otherwise OpenLoops uses `local`.

`LOOPS_API_URL` and `HASNA_LOOPS_API_URL` belong to `self_hosted`.
`cloud` uses only `LOOPS_CLOUD_API_URL` or `HASNA_LOOPS_CLOUD_API_URL`.

Tokens are represented only as presence signals in status output. Self-hosted
status uses `LOOPS_API_TOKEN` or `HASNA_LOOPS_API_TOKEN`. Cloud status uses
`LOOPS_CLOUD_TOKEN` or `HASNA_LOOPS_CLOUD_TOKEN`. URL credentials, query
strings, and fragments are not returned in status output.

## Commands

```bash
loops mode
loops --json mode
loops self-hosted status
loops cloud status
loops-api status
loops-runner status
```

Human status output is intentionally compact:

```text
deploymentMode=local active source=default truth=local_sqlite local=authoritative control_plane=none
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
  configuration to be usable. Cloud requires both a cloud URL and a cloud token
  presence signal.
- `controlPlane.apiUrl`: a display-safe URL without credentials, query string,
  or fragment.

`loops-api` is a separate process in the same public package. It is not a
separate package at this stage because self-hosted users and the hosted service
must share the same public contract. The API server can expose storage-backed
`/v1` loop CRUD and run listing when an embedding host injects the public
storage contract. The standalone `loops-api serve` binary still fails closed
for those routes until a self-hosted storage adapter is wired by the operator or
platform host.

`loops-runner` is the process that connects a machine to a non-local control
plane. The initial foundation exposes status only. The Postgres schema, claim
protocol, runner heartbeat/finalization protocol, and import/export migration
must land before `loops-runner` is advertised as an executing worker.

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
machine execution is runner-pull: a registered `loops-runner` claims work from
the control plane. Operators should not treat local remote dispatch as cloud
mode.

## Follow-Up Work

Non-local execution needs these follow-up releases before it is live:

- A full Postgres control-plane adapter behind the public storage contract.
- Runner placement, capability labels, leases, heartbeat, claim/finalize, and
  evidence upload.
- Import/export migration between local SQLite state and a control plane.
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
