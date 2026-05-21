# CLI/MCP Parity

`@hasna/todos` exposes the same local task system through the `todos` CLI and
the `todos-mcp` stdio server. The side-effect-free parity manifest is exported
from the root package as:

- `TODOS_CLI_MCP_PARITY`
- `TODOS_CLI_MCP_PARITY_MANIFEST`
- `createCliMcpParityManifest()`

The manifest is local-only and does not need network access. Each entry maps a
supported workflow domain to CLI commands, MCP tools, stable JSON contracts, and
structured error contracts.

## Covered Domains

- `tasks`: create, list, read, update, lifecycle, assignment, queue, and bulk
  workflows.
- `projects`: project registration, project updates, task lists, path
  resolution, and focus.
- `plans`: plan create, list, read, update, complete, and delete workflows.
- `runs`: local task-run ledgers, events, commands, files, artifacts, and
  finish records.
- `comments`: task comments, progress notes, and activity entries.
- `search`: search, status, standup, report, graph, context, and recent
  activity workflows.
- `imports`: template imports, inbox intake, and local bridge imports.
- `exports`: template exports, traceability exports, verification records, and
  local bridge exports.

## Examples

CLI task creation:

```bash
todos add "Fix flaky parser" --priority high --json
```

Matching MCP tool:

```json
{ "tool": "create_task", "arguments": { "title": "Fix flaky parser", "priority": "high" } }
```

CLI bridge export:

```bash
todos export --format bridge --output todos-bridge.json --json
```

The full local bridge export is intentionally CLI-only because it writes a local
file. MCP callers should use scoped traceability tools such as
`get_task_traceability`, `get_task_commits`, and `get_task_run_ledger` when they
do not need a whole-store bundle.

CLI bridge import:

```bash
todos bridge-import todos-bridge.json --apply --json
```

The full local bridge import is intentionally CLI-only and dry-run first because
it can write many local records. MCP callers can use scoped intake tools such as
`create_inbox_item` and `import_template`.

## Contract Rules

- Stable JSON objects are listed in `docs/json-contracts.md`.
- CLI JSON errors use `api_error`.
- MCP errors use `structured_error`.
- New parity domains, commands, or MCP tools must update
  `TODOS_CLI_MCP_PARITY` and the regression tests before release.
