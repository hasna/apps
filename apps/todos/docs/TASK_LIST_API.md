# Shared task-list workflow

The MCP `create_task_list`, `list_task_lists`, `get_task_list`,
`update_task_list`, and `delete_task_list` tools use the authenticated Todos API
and shared server storage. Saved account credentials work in a fresh process;
these callbacks never select SQLite or fall back to an on-box database.

Task-list status is persisted as `active`, `completed`, or `archived`. Existing
PostgreSQL JSON records without status are read as active without rewriting
historical snapshots. Explicit SQLite library create/update and snapshot import
reject status-bearing input before opening storage because that legacy schema
cannot retain the field. No client or user database migration runs here.

Detail reads include subtasks and exhaust the server's filtered pages, up to
10,000 tasks. Missing/changing totals, duplicate IDs and scope mismatches fail
explicitly instead of presenting a truncated successful result. Ambiguous list
selectors and malformed mutation receipts also fail explicitly. A server that
cannot persist requested fields or perform preserving deletion must be upgraded.

`POST /v1/task-lists/{id}/delete-preserving` accepts `{force:false}` by default.
A nonempty list is refused. With `force:true`, one transaction deletes the list
and clears the canonical `task_list_id` references on its tasks and plans. Task
content, task history, plan content and unrelated project routing slugs remain.
The typed receipt names every detached task and plan. A failed transaction
returns no successful receipt. A lost response requires inspecting server state;
there is no claim of an idempotent historical receipt journal for this operation.
The existing DELETE route uses the same safe non-force behavior.

Membership writes and deletion share the service-scoped integrity lock. New
references to a missing list are rejected; unchanged historical dangling
references can still be repaired by unrelated updates. Legacy snapshot import
orders task lists and plans before referencing tasks and retains its documented
per-record partial receipt semantics; this is not a new atomic migration API.

This closes five additional MCP callbacks. The historical 107 CLI / 93 MCP
remaining-surface assessment is a baseline, not a claim that all Todos commands
are converted. Other administrative and local compatibility surfaces still need
separate migration and release acceptance.

## CLI lists

`todos lists`, `todos task-lists`, and `todos tl` use the same shared API.
`--add`, `--show`, `--update`, and `--delete` are mutually exclusive. Names,
slugs and descriptions retain their existing flags; `--status` filters the list
or sets status during add/update. Show includes all matching task pages, including
subtasks, under the 10,000-task bound. Explicit `--project` retains scoped lookup
and update rebinding semantics; there is no local cwd database discovery.

Deletion returns the checked preserving receipt. `--force` detaches linked
records without deleting their content. Unsupported or malformed server results
fail rather than printing successful deletion. Database/local-mode selectors are
rejected before command modules load, even when API credentials are also present.
Credential-free help remains available. Other CLI families, including remaining
plan artifact paths, are outside this bounded conversion.
