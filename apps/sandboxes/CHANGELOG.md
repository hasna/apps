# Changelog

## 1.0.2

### Fixed

- **`exec` now propagates non-zero exit codes instead of throwing.** The live E2B
  backend called `sandbox.commands.run()`, which the E2B SDK *rejects* with a
  `CommandExitError` on any non-zero exit (it awaits `CommandHandle.wait()`).
  The backend let that error escape, so `sandboxes -p e2b exec <id> <cmd>`
  surfaced the SDK's raw `error: exit status N`, discarded the command's
  stdout/stderr, and masked the real exit code to `1`. `exec` now recovers the
  true exit code and captured output from `CommandExitError` and returns a normal
  `ExecResult`; a failing command reports its actual non-zero code. Added hermetic
  regression coverage (faked SDK that throws exactly like the real one).

## 1.0.1

### Fixed

- Real E2B `getLogs` via the documented `GET /v2/sandboxes/{sandboxID}/logs`
  endpoint, and a typed unsupported result for `listExposedPorts` (E2B has no
  port-enumeration API) instead of a misleading empty list.

## 1.0.0

**From-scratch rebuild: new E2B/Daytona managed adapters + rebuilt CLI & MCP;
old storage/sdk sandbox-manager API replaced.**

### Breaking

- The legacy sandbox-manager surface is **removed**: the `@hasna/sandboxes/storage`
  and `@hasna/sandboxes/sdk` subpath exports, the `sandboxes-serve` HTTP server
  bin, the Postgres-backed store, and the generated REST SDK no longer exist.
- The `.` export now surfaces the **managed E2B/Daytona adapters** (guest broker,
  disposable-task runners, encrypted checkpoint handoff) instead of the old
  storage/SDK client. An explicit `./adapters` alias is also published.

### Added

- **`sandboxes` CLI** (`bin: sandboxes`) — disposable sandbox lifecycle over the
  managed adapters: `create`, `list`, `get`, `exec`, `logs`, `write-file`,
  `read-file`, `list-files`, `expose-port`, `list-ports`, `snapshot`, `stop`,
  `keep-alive`, `destroy`, with `--provider local|e2b|daytona` and `--json`.
- **`sandboxes-mcp` MCP server** (`bin: sandboxes-mcp`, stdio) — reproduces the
  core sandbox-manager MCP tools so existing `mcp__sandboxes__*` client configs
  keep working: `create_sandbox`, `list_sandboxes`, `get_sandbox`,
  `delete_sandbox`, `stop_sandbox`, `keep_alive`, `exec_command`, `read_file`,
  `write_file`, `list_files`, `get_logs`, `expose_port`, `list_exposed_ports`,
  `snapshot_sandbox`, `upload_dir`, `run_agent`, `version`, `health`.
- A **local** provider: a persistent, deterministic in-process sandbox simulator
  (no host processes, no network) that rides on the managed guest-broker request
  framing. It is the default provider and the target for the hermetic test suite.
- Credential loading from environment variables or the `secrets` CLI vault
  (`E2B_API_KEY`, `DAYTONA_API_KEY`, `DAYTONA_API_URL`). Secrets stay in memory
  and are never logged, printed, or persisted.

### Notes

- Live `e2b`/`daytona` backends require real credentials and network access and
  are not covered by the hermetic test suite. `daytona snapshot` is not yet
  implemented (use provider-native snapshots).
