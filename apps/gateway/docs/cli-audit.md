# CLI audit and backend parity

## Summary

- Audited every command token registered by `runCli` in `src/cli/index.ts`, including the implicit bare invocation that defaults to `help`.
- Found no dead, broken, removed-code, or non-functional commands.
- HTTP/API backend parity is not applicable because this CLI has no remote HTTP client backend. All config-aware commands load a local config path and call in-process modules.
- Added a regression test that pins the parser-derived command inventory and exercises all three help invocations.

## API backend scope

The repository ships an HTTP gateway server, but it does not ship a second HTTP/API backend for CLI operations:

- `GatewayConfig` defines runtime, server, inbound auth, storage, policy, providers, models, routes, and budgets. It has no remote gateway API URL or remote CLI credential.
- `GatewayAuthConfig.apiKeyEnv` configures inbound authentication for the server; it is not a CLI HTTP-client credential.
- The CLI imports config, routing, budget, smoke, and server functions directly. Its config-aware handlers read `--config` from the local filesystem and invoke those modules in-process.
- Outbound HTTP calls in `src/providers` target configured model providers for inference and smoke checks. They are not an alternate backend for CLI state operations.
- `runtime.mode: "production-cloud"` hardens a deployed server. `storage.cloud` selects an in-process SQLite or PostgreSQL usage-ledger adapter. Neither is a cloud-router/stage-A/HTTP CLI path.
- `tests/no-cloud-boundary.test.ts` enforces removal of the retired shared cloud runtime from dependencies, tracked source, and built output.

Therefore the amended task's local-versus-API parity work is **N/A**. Implementing a new remote CLI protocol would invent an architecture that this repository intentionally does not expose.

## Command inventory

The inventory comes from the default in `parseArgs` and every `parsed.command === ...` branch in `src/cli/index.ts`, not from README documentation. Option variants such as `smoke --all` remain part of their registered command row.

| command | works locally? | works against the API backend (or N/A)? | dead? | changed in this PR? |
| --- | --- | --- | --- | --- |
| `gateway` | Yes; defaults to help | N/A | No | No |
| `gateway help` | Yes | N/A | No | No |
| `gateway --help` | Yes | N/A | No | No |
| `gateway --version` | Yes | N/A | No | No |
| `gateway budget-add` | Yes; reads, validates, and updates the selected local config | N/A | No | No |
| `gateway budget-list` | Yes; loads and lists normalized config budgets | N/A | No | No |
| `gateway budget-remaining` | Yes; reads configured JSONL and/or direct SQLite/PostgreSQL ledger storage | N/A | No | No |
| `gateway budget-reset` | Yes; validates and updates the selected local config | N/A | No | No |
| `gateway route` | Yes; performs an in-process dry-run route decision | N/A | No | No |
| `gateway routes` | Yes; lists in-process normalized route configuration | N/A | No | No |
| `gateway uninstall` | Yes; removes the selected local config and configured JSONL ledger with safeguards | N/A | No | No |
| `gateway remove` | Yes; guarded `uninstall` alias requiring `--all --yes` | N/A | No | No |
| `gateway validate` | Yes; validates the selected local config | N/A | No | No |
| `gateway smoke` | Yes; performs provider traffic when credentials exist and reports skip/failure semantics otherwise; `--all` is implemented | N/A | No | No |
| `gateway serve` | Yes; starts the configured HTTP gateway server | N/A | No | No |

## Changes

- No production command implementation changed because the audit found no dead command and no applicable API backend.
- `tests/cli-help.test.ts` now fails if parser registration drifts from the audited command inventory and verifies the bare, `help`, and `--help` forms.

## Verification

- `git diff --check`
- Parser inventory extraction independently verified all 14 explicit command tokens; the table additionally includes the parser's implicit bare invocation.
- Run `bun run check` in a Bun-enabled environment for typecheck, build, and the complete test suite.
