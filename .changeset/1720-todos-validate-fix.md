---
"@hasna/todos": patch
---

Fail closed on every surface (hasna/apps#1720 validation, round 1).

- `todos-mcp` (stdio) decides its authority BEFORE it serves. With no
  credential anywhere it exits non-zero with the `REMOTE_API_CONFIG_MISSING`
  line on stderr — naming the Keychain item `hasna.credentials.todos.api-key`,
  `~/.hasna/todos/config/credentials`, `HASNA_TODOS_API_KEY` and the
  `HASNA_TODOS_LOCAL=1` opt-in — before `initialize` is answered, and creates
  no `todos.db`. It used to open (and create) the local store on every start.
- On the hosted route the MCP server refuses the on-box SQLite store
  altogether: every local-only tool family (machines, dispatch, templates,
  handoffs/boards/time, runs, knowledge, …) and every `todos://` resource
  returns `REMOTE_COMMAND_UNSUPPORTED` naming the opt-in instead of reading an
  empty local file (`resources/read todos://projects` no longer answers `[]`
  while the fleet holds thousands of projects). Agent focus is answered from
  the session on the hosted route, never from the local agents table.
- `REMOTE_API_*` / `REMOTE_COMMAND_*` refusals reach the MCP client under their
  own code instead of `UNKNOWN_ERROR`; they name sources only, never a value.
- `@hasna/todos/sdk`: `new TodosClient()` with nothing resolved throws
  `TODOS_CREDENTIAL_MISSING` (the same code `createTodosV1Client` used) instead
  of degrading to `http://localhost:19427`. The local serve is reachable only
  under the explicit `HASNA_TODOS_LOCAL=1` opt-in, which prints its one-line
  notice.
- The local store honours `HASNA_HOME` (absolute, non-blank) as the `~/.hasna`
  root, the same rule `@hasna/contracts` applies to the credentials file.
- `hasna.contract.json` declares the CLI and MCP surfaces as `api-key`
  (hosted via the contracts chain; local only under the opt-in).
