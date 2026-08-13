# MCP Server

`actions-mcp` runs an MCP server over stdio using the same local store as the
CLI and SDK.

```json
{
  "command": "actions-mcp",
  "env": {
    "HASNA_ACTIONS_DIR": "/absolute/path/to/actions-data"
  }
}
```

The server serializes successful tool results as JSON text. Handler failures are
returned as MCP error results with the message as text.

## Detail Levels

Tools that return manifests or runs accept `detail`:

- `compact` is the default and returns bounded summaries.
- `verbose` adds bounded fields and input/output previews.
- `full` returns complete stored objects.

List tools always return `{ kind, page, items, hint }`. Their default page size
is 10, their maximum effective page size is 100, and `page.nextCursor` is the
offset for the next call. Full lists remain paginated.

## Tools

| Tool | Inputs | Behavior |
| --- | --- | --- |
| `actions_register_manifest` | `manifest`, `detail?` | Validates and stores a manifest. Local-shell bindings become executable in this server. |
| `actions_list_manifests` | `limit?`, `cursor?`, `detail?` | Lists stored manifests. |
| `actions_show_manifest` | `actionId`, `detail?` | Gets one exact manifest id or returns `{ error: "not found" }`. |
| `actions_run` | `actionId`, `input?`, `idempotencyKey?`, `dryRun?`, `approve?`, actor fields, `detail?` | Plans, previews, and optionally executes a registered action. |
| `actions_approve` | `runId`, `reason?`, actor fields, `detail?` | Records an approval. |
| `actions_deny` | `runId`, `reason?`, actor fields, `detail?` | Records a denial. |
| `actions_execute` | `runId`, `rollbackOnFailure?`, `detail?` | Attempts execution of a registered run. |
| `actions_show_run` | `runId`, `detail?` | Gets one exact run id or returns `{ error: "not found" }`. |
| `actions_list_runs` | `actionId?`, `status?`, `limit?`, `cursor?`, `detail?` | Lists newest runs with exact-match filters. |

Actor fields are `actorId` and `actorType`; type can be `human`, `agent`,
`service`, or `system`. Defaults are id `mcp` and type `agent`.

`actions_run` defaults omitted input to `{}`. `approve: true` records one
approval with reason `MCP approve=true`; additional count or role requirements
can still block execution. Omitted `dryRun` follows the manifest default.

Registering a non-local-shell manifest stores it with a placeholder executor so
it can be inspected, but an execution attempt fails because this standalone
server has no in-process implementation for that binding. Host applications can
instead call `createServer({ deps: { client } })` with an `ActionsClient` whose
TypeScript definitions are already registered.
