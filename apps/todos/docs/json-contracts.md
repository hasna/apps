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
