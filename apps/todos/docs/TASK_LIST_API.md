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
