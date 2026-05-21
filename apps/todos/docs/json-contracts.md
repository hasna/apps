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
- `local_task_fields`
- `duplicate_task_candidate`
- `task_merge_result`
- `agent`
- `template`
- `task_list`
- `comment`
- `checkpoint`
- `dispatch`
- `audit_history`
- `local_activity_timeline_entry`
- `status_summary`
- `context_pack`
- `local_event_hook`
- `local_event_hook_delivery`
- `local_encryption_profile`
- `local_encryption_envelope`
- `encrypted_local_bridge_bundle`
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

## Local Task Fields

`local_task_fields` is the stable object returned by `todos fields show`,
`todos fields set --json`, `get_task_fields`, and `set_task_fields`. It keeps
labels, priority, severity, owner, area, and custom local metadata in task
metadata so bridge exports and imports carry it without any hosted dependency.

## Duplicate Tasks

`duplicate_task_candidate` is the stable object returned in each item from
`todos dedupe scan --json` and `find_duplicate_tasks`. It includes the primary
task, duplicate task, score, and human-readable reasons for the match.

`task_merge_result` is returned by `todos dedupe merge --json` and
`merge_duplicate_task`. It includes the updated primary task, archived duplicate
task, duplicate relationship id, and moved evidence counts.

## Agent Context Packs

`context_pack` is the stable local bundle shape returned by
`todos context-pack --format json` and `build_agent_context_pack`. It includes
selected task, project, plan, dependency, comment, file, verification, and run
evidence plus a profile-specific prompt bundle for local agents.

## Local Event Hooks

`local_event_hook` is the stable config object returned by
`todos event-hooks list`, `todos event-hooks set`, `list_local_event_hooks`,
and `set_local_event_hook`. `local_event_hook_delivery` is the stable delivery
result returned by `todos event-hooks test` and `test_local_event_hook`.

## Local Encryption

`local_encryption_profile` is the stable config object returned by
`todos encryption list`, `todos encryption set`, `list_encryption_profiles`,
and `set_encryption_profile`. Profiles store algorithm metadata, a nonsecret
salt, and the environment variable name that supplies key material.

`local_encryption_envelope` is the encrypted JSON value shape returned by local
field encryption helpers and MCP value tools. `encrypted_local_bridge_bundle`
wraps a bridge export so tasks, evidence, artifact content, and metadata are not
stored as plaintext JSON.

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
