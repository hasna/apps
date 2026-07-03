# OpenLoops Deployment Modes

OpenLoops supports one active source of truth at a time. The public package
defines the mode vocabulary, local cache behavior, API shape, and runner
contract. Hosted multi-tenant operation is implemented outside this public
package.

## Modes

| Mode | Source of truth | Local storage role | Executor |
| --- | --- | --- | --- |
| `local` | SQLite in `LOOPS_DATA_DIR` | Authoritative | `loops-daemon` |
| `self_hosted` | A user-operated `loops-api` control plane | Cache and offline spool | `loops-runner` |
| `cloud` | A configured hosted control plane | Cache and offline spool | `loops-runner` |

`local` remains the default. It must keep working without network access,
tokens, Postgres, or hosted infrastructure.

`self_hosted` is for users or teams running their own control plane. The public
`@hasna/loops` package owns the API and runner contract for this mode.

`cloud` is the hosted control-plane contract. The public package exposes the
client and runner contract, but tenant auth, account administration, and hosted
infrastructure stay outside this package. The public package must not depend on
private hosted packages or resource names.

## Mode Resolution

`LOOPS_MODE` or `HASNA_LOOPS_MODE` may be set to `local`, `self_hosted`, or
`cloud`. Hyphenated `self-hosted` is normalized to `self_hosted`.

When no explicit mode is set, OpenLoops resolves the mode from configuration:

1. `LOOPS_CLOUD_API_URL` or `HASNA_LOOPS_CLOUD_API_URL` selects `cloud`.
2. `LOOPS_API_URL`, `HASNA_LOOPS_API_URL`, `LOOPS_DATABASE_URL`, or
   `HASNA_LOOPS_DATABASE_URL` selects `self_hosted`.
3. Otherwise OpenLoops uses `local`.

Tokens are represented only as presence signals in status output:
`LOOPS_API_TOKEN`, `HASNA_LOOPS_API_TOKEN`, `LOOPS_CLOUD_TOKEN`, and
`HASNA_LOOPS_CLOUD_TOKEN`.

## Commands

```bash
loops mode
loops --json mode
loops self-hosted status
loops cloud status
loops-api status
loops-runner status
```

`loops-api` is a separate process in the same public package. It is not a
separate package at this stage because self-hosted users and the hosted service
must share the same public contract.

`loops-runner` is the process that connects a machine to a non-local control
plane. It advertises machine identity, polls for runnable work, claims leases,
executes locally, and records evidence. The initial foundation exposes status
only; the Postgres schema, claim protocol, and import/export migration are
tracked as follow-up implementation tasks.

## Machine Placement

A loop can eventually target:

- one specific machine,
- a machine pool selected by capability labels,
- or multiple machines intentionally.

Single-run loops need a lease so only one runner executes each scheduled slot.
Multi-machine loops must record per-machine run evidence so duplicate work is
distinguishable from intentional fan-out.

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
