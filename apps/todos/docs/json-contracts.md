# JSON Contracts

`@hasna/todos` treats machine-readable JSON as a public integration surface for
the CLI, local HTTP API, SDK, and MCP server. The canonical machine-readable
manifest is exported from `@hasna/todos/contracts` as:

- `TODOS_JSON_CONTRACTS`
- `TODOS_JSON_CONTRACTS_MANIFEST`
- `createJsonContractsManifest()`
- `getJsonContract()`
- `validateJsonContract()`

## Covered Objects

The stable contracts cover these object IDs:

- `task`
- `project`
- `agent`
- `template`
- `task_list`
- `comment`
- `checkpoint`
- `dispatch`
- `audit_history`
- `status_summary`
- `structured_error`
- `api_error`
- `local_bridge_bundle`
- `local_bridge_import_result`
- `cli_mcp_parity_manifest`
- `project_bootstrap_result`

## Evolution Rules

JSON contracts are additive by default.

- Adding a new field is allowed.
- Adding an optional field is allowed.
- Removing a required field is breaking.
- Renaming a required field is breaking.
- Changing a required field type is breaking.
- Changing a nullable required field to non-nullable is breaking.
- Narrowing enum values used by a required field is breaking.

Callers should ignore unknown fields and pin behavior to required fields in the
manifest. Optional fields may be absent on older command, API, SDK, or MCP
surfaces.

## Error Shapes

Two error shapes are stable:

- `structured_error` for MCP and SDK style errors with `code` and `message`.
- `api_error` for CLI and HTTP API JSON errors with `error`.

New machine-readable fields may be added to either error object. Existing
clients should keep displaying the string message and use stable `code` values
when present.

## Local Bridge Bundles

`local_bridge_bundle` is the stable offline import/export shape for moving local
`@hasna/todos` data between stores. It contains versioned package metadata,
source scope, grouped records for projects, task lists, plans, tasks,
dependencies, comments, runs, run evidence, file evidence, git refs, commits,
and verification records.

`local_bridge_import_result` is returned by dry-run and applied imports. It
reports inserted counts, skipped counts, conflicts, and validation issues so a
caller can inspect what would change before writing to local SQLite.

## CLI/MCP Parity Manifest

`cli_mcp_parity_manifest` is the stable machine-readable shape for the
side-effect-free CLI/MCP parity registry. It records local-only package metadata,
the covered task/project/plan/run/comment/search/import/export domains, matching
MCP tools, JSON contracts, error contracts, and intentional gaps.

## Project Bootstrap Result

`project_bootstrap_result` is returned by local workspace bootstrap commands.
It includes dry-run status, workspace discovery, the registered project, the
default task list, source records, and created flags. Dry-runs return null for
the project and task list because no local SQLite rows are written.
