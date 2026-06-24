# Fleet Control Contract

This document defines the boundary between `@hasna/computer` and
`@hasna/machines` for fleet-aware computer control. It is a public contract and
must not contain private fleet state, real machine IDs, hostnames, usernames,
network addresses, route targets, credentials, or customer topology.

## Ownership

| Area | Owner | Contract |
| --- | --- | --- |
| Goal planning, provider calls, policy routing, approvals, runtime ledger, local display control, terminal/app drivers, and artifact references | `@hasna/computer` | Model output is advisory. Open-computer records goals, workflow runs, approvals, leases, policy decisions, audit events, observations, and artifacts. |
| Machine identity, topology, route hints, workspace mapping, compatibility checks, setup/sync plans, storage sync, machine-local agent, CLI, and MCP server | `@hasna/machines` | Consumers use `@hasna/machines/consumer`, machines CLI JSON, or machines MCP tools. They do not import internal manifest, database, agent, installer, or storage primitives. |
| Browser page automation and visible Chrome extension sessions | `@hasna/browser` | Fleet routing can select where a browser session should run, but browser execution remains the browser lane. |

## Machine Identity

- A machine ID is an opaque registry resource ID, not a hostname, SSH target,
  URL, IP address, Tailscale name, username, or filesystem path.
- Open-machines is the authority for machine resolver envelopes. Its stable
  consumer contract version is `1`, with `topology`, `route`, `workspace`,
  `compatibility`, and `resolver_snapshot` envelopes.
- Open-computer may cache resolver evidence only with the envelope's
  cacheability metadata and must refresh stale evidence before mutating a
  remote machine.
- Committed docs and package metadata must use placeholders such as
  `<machine-id>`, `<workspace-root>`, and `<route-endpoint>`.
- Private output, when explicitly enabled in a lab or operator session, belongs
  in local artifacts or temporary reports, not in committed documentation.

## Trust

- `fleet.capabilities` and `fleet.route` are read-only planning operations.
- `fleet.run_smoke` and `fleet.pull_artifact` are mutating operations because
  they execute on a machine or extract machine evidence.
- Approval authorizes intent only. It is not a transport credential, SSH grant,
  API key, mTLS proof, resident-agent token, or artifact release.
- Any mutating fleet operation requires a capability-scoped approval, explicit
  transport opt-in, machine-bound transport record, verified machine/action
  capability token, resource lease, execution through the owning fleet adapter,
  and redacted audit.
- Audit and route metadata must record classes and booleans such as transport
  kind, auth class, endpoint class, token presence, explicit opt-in, and
  machine-binding match. They must not record raw route targets or token values.

## Routes

Open-machines route resolution may use manifest entries, local heartbeats, SSH
route hints, LAN reachability, and Tailscale status. Open-computer consumes the
result as a resolver envelope and never constructs ad hoc shell targets from a
planner prompt.

Route classes:

- `local`: the target is the current process machine.
- `lan`, `tailscale`, and `ssh`: candidate remote reachability classes.
- `unknown`: no executable route is available.

Open-computer route decisions are policy results, not execution. A planner
route for `fleet.run_smoke` can return `requires_confirmation` or `blocked`
until secure transport evidence is supplied. An adapter must not bypass that by
shelling to SSH, calling a remote MCP endpoint, or pulling artifacts directly.

## Workspaces

Workspace mapping comes from open-machines `resolveMachineWorkspace` and related
CLI/MCP JSON. A workspace envelope may include project identity, path mappings,
diagnostics, repair hints, trust status, auth status, and cacheability.

Open-computer uses workspace roots for policy decisions, terminal approval, and
artifact scoping. A workspace path is not enough to authorize terminal commands,
package installs, sync, or remote job execution. Terminal execution still needs
the terminal policy path, command approval, and transcript/audit rules.

## Display And Browser Resources

Open-computer owns local display control and runtime leases for
`computer_display`, `terminal_session`, `browser_extension_session`, and
`fleet_machine`. Only one active controller may hold the same resource.

Open-machines may resolve screen-sharing or route metadata for an operator or
lab validation flow, but it does not become the browser-control owner. Browser
page automation and visible Chrome extension work stay in `@hasna/browser`.
Fleet selection can decide where a browser lane should run; execution still
must use the browser lane's approval, pairing, session, and evidence rules.

## Capability Surface

Open-computer may use:

- `@hasna/machines/consumer` for topology, route, workspace, compatibility, and
  resolver-snapshot envelopes.
- `machines topology --json`, `machines route --json`, and
  `machines workspace --json` as CLI fallback shapes when the SDK is absent.
- `machines-mcp` read tools for topology, route, workspace, compatibility, and
  status when authenticated by the selected transport.

Open-computer must not depend on open-machines internals for manifest writes,
database access, storage adapters, notification/event mutation paths, setup
apply, sync apply, DNS/cert/backup apply, or daemon internals. Mutators exposed
by open-machines SDK, CLI, or MCP require machines-scoped mutation approval and
the plan/token rules owned by open-machines.

## Leases

The fleet execution order is:

1. Plan a typed fleet capability and record the route decision.
2. Resolve the machine through the open-machines contract.
3. Request approval when the capability mutates remote state or extracts
   machine evidence.
4. Bind an explicit authenticated transport to the same machine ID.
5. Verify a machine/action-scoped capability token.
6. Acquire a `fleet_machine` lease before remote execution.
7. Acquire `computer_display`, `browser_extension_session`, or
   `terminal_session` leases when the job touches those resources.
8. Execute through open-machines or a resident agent.
9. Attach redacted observations and artifacts.
10. Release leases and record final status, cancellation, or failure.

Competing controllers must queue or fail with a clear lease-conflict reason.
Lease failure must happen before any remote side effect.

## Remote Job Queue

Production remote job dispatch is a future adapter contract. Until that adapter
exists, source-checkout live-machine validation remains lab-only and must not be
presented as a production remote job API.

The future job envelope must be dry-run serializable before execution and must
include:

- contract version,
- goal ID, workflow ID, run ID, and step index,
- requested capability and canonical tool input,
- machine ID and resolver snapshot reference,
- approval ID and policy decision reference,
- transport kind, auth class, endpoint class, and token-present metadata,
- required resource leases,
- workspace mapping and allowed workspace roots,
- artifact contract for expected outputs,
- cancellation channel and timeout,
- audit correlation ID.

The queue must not embed raw provider prompts, screenshots, secrets, private
routes, raw tokens, or arbitrary shell commands. It may reference redacted
artifact IDs and runtime rows that remain under open-computer retention policy.

## Artifact Boundary

Fleet artifact pulls use the contract in `docs/secure-remote-transport.md`.
Hash-only mode is the default. Materialized pulls require approved namespaces,
source scope, max bytes, expected SHA-256, matching materialization approval,
result binding validation, and redaction metadata. Artifact IDs must not target
private filenames, traversal paths, user-host specs, URLs, or platform paths.

## Implementation Status

| Capability | Current state |
| --- | --- |
| Planner route schema for fleet capabilities | Implemented in open-computer. |
| Secure transport decision for mutating fleet routes | Implemented in open-computer planner routing. |
| Artifact pull safety wrapper | Implemented in open-computer. |
| Live machine validation through fleet route/lease/audit | Implemented as a source-checkout lab-only gate. |
| Optional packaged open-machines consumer integration | Planned in P5-01. |
| Machine/display/browser lease acquisition for production remote control | Planned in P5-03. |
| Remote job dispatch queue and dry-run envelope | Planned in P5-04. |
| Production remote execution adapter | Not implemented yet. |

## Release Invariants

- This document ships in the `@hasna/computer` package and is checked by the
  release verifier.
- The package must continue to avoid a hard dependency on `@hasna/machines`.
- Any new fleet adapter must add tests proving approval alone cannot execute a
  remote mutation, private route data is redacted from audit, lease conflicts
  fail before side effects, and artifacts cannot materialize without the
  artifact contract.
