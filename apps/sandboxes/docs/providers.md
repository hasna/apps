# Provider behavior

The CLI and MCP server share the `SandboxBackend` interface, but provider SDKs
do not expose identical capabilities. Callers should account for the following
current behavior rather than assuming full feature parity.

## Capability matrix

| Operation | `local` | `e2b` | `daytona` |
| --- | --- | --- | --- |
| Create, list, get, destroy | Persistent simulator state | Live SDK | Live SDK |
| Stop | Status becomes `stopped` | Pauses; returned status is `paused` | Stops; returned status is `stopped` |
| Keep alive | Updates recorded expiry | Calls `setTimeout` | No-op; returns the current record |
| Exec | Deterministic simulation | Live command execution | Live command execution |
| Logs | Simulator lifecycle log | E2B `/v2/sandboxes/{id}/logs` API | Empty list |
| Write/read/list files | Simulated `/workspace` | E2B filesystem API | Guest shell commands through Daytona process execution |
| Expose port | Deterministic `.invalid` URL | `getHost(port)` HTTPS URL | Preview-link API |
| List exposed ports | Recorded simulator ports | Typed unsupported error | Empty list |
| Snapshot | Simulator filesystem digest | `createSnapshot()` when exposed by the pinned SDK; typed unavailable error otherwise | Typed unsupported error |

## Local simulator

The default local provider persists JSON state under
`$SANDBOXES_HOME/instances`, or `$HOME/.hasna/sandboxes/instances` when
`SANDBOXES_HOME` is unset. Separate CLI invocations therefore see the same
simulator instances.

It never launches a host process and never performs network requests. Its exec
implementation recognizes `true`, `false`, `echo`, `pwd`, `cat`, `ls`, and
simple `sh -c`/`bash -c` commands. Unknown commands succeed with an explicit
`[local-sim] executed: ...` line. Files are confined to normalized absolute
paths under `/workspace` and flow through the managed guest-broker framing
contract.

Create and keep-alive record expiry timestamps, but the simulator does not run
a background expiry worker. Exposed ports return non-routable
`https://<port>-<id>.local.sandboxes.invalid` URLs.

## E2B

The E2B backend loads the pinned `e2b` package at runtime and requires
`E2B_API_KEY`. Create forwards template, metadata, and millisecond timeout.
Nonzero command exits are returned as normal execution results rather than
transport failures.

Logs use the SDK's typed API client against the versioned E2B REST endpoint and
fail closed on unavailable API surfaces, non-2xx responses, provider errors, or
missing response bodies. The pinned SDK can produce a URL for a requested port
but has no authoritative API for enumerating all exposed ports.

## Daytona

The Daytona backend loads the pinned `@daytona/sdk` package at runtime and
requires `DAYTONA_API_KEY`; `DAYTONA_API_URL` overrides the SDK endpoint. Create
maps `template` to `snapshot` and metadata to provider labels. The current
provider-neutral readback does not reconstruct template, metadata, labels,
expiry, or original creation time from Daytona, so those returned fields use
neutral empty/current values.

Create ignores `timeout_ms`, and keep-alive currently performs no lifetime
extension. Exec converts a millisecond timeout to rounded-up seconds. File
operations use carefully shell-quoted commands; listed entries distinguish
files from directories but report `size: null`.

## Credentials

For live providers, credential resolution checks the process environment first
and then runs `secrets get <NAME> --raw`. Values remain in memory and are passed
to the provider SDK; this package does not log or persist them. The local
provider does not consult credentials.
