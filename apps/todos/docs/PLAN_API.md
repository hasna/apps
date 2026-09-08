# Shared plan tools

The five MCP tools `create_plan`, `list_plans`, `get_plan`, `update_plan`, and
`delete_plan` use the authenticated shared API. Saved account credentials work
in fresh MCP processes; none of these callbacks opens SQLite or falls back to
local data. The existing API-backed CLI plan commands continue to use the same
server records. Reads include every advertised task page, including subtasks.

Plans retain the existing `active` default and `active`, `completed`, `archived`
statuses. `planning` and `cancelled` are now persisted states too. Optional
`start_date` and `end_date` are ISO calendar dates (`YYYY-MM-DD`); impossible dates
and an end before the start are rejected before mutation. Ordinary plan patches
compare the observed revision under the row lock, so a stale full-plan write
fails with a revision conflict instead of overwriting an accepted schedule. Absent legacy dates
remain absent. API patches can clear a date with JSON null. The PostgreSQL record
store persists these additive JSON fields without changing tables or rewriting
historical records. Explicit SQLite library calls reject the new unsupported
fields before opening storage rather than silently dropping them.

`POST /v1/plans/:id/delete-preserving` refuses a nonempty plan unless `force` is
true. Force deletes only the plan: linked tasks retain content, comments,
history and project membership; their plan membership is detached and versions
advance. A referenced task list is preserved unchanged. The receipt identifies
the detached tasks and task list, with matching counts. Plan comments remain
stored as history. An absent plan produces `deleted:false` and empty counts.
The operation locks plan membership and commits all detaches and deletion in one
transaction; any write failure rolls back everything. Concurrent task membership
writes cannot commit a dangling link to the deleted plan. The existing generic
DELETE route retains its prior compatibility contract; MCP uses the explicit
preserving endpoint and never interprets an unavailable endpoint as success.

All `/v1` handlers now enforce the configured deployment corpus tenant after
signature/scope authentication and before schema or storage access. A key with a
different tenant is rejected. A legacy key without a tenant is accepted only by
the default corpus. This does not turn the single-corpus service into a shared
multi-tenant database; operators must configure the deployment tenant correctly.

Before this patch the corpus fence covered machines, projects, and selected
migration paths, but did not uniformly cover tasks, plans, templates, agents,
activity, task lists, dependencies, commits, refs, next, stats, integrity,
non-machine imports, or the early specialized PR-group/project-registration/
task-manifest/subtree-transfer dispatches. The shared fence covers these too.

This closes only the five named MCP callbacks from the historical remaining-local
inventory (107 CLI / 93 MCP baseline); it is not a fresh whole-app census or an
all-command completion claim. No deployment, data transfer, or database retirement
is performed by this source change. A separately reproduced pre-existing
plan-project-link concurrent-apply receipt drift remains tracked: the operation
can commit, then detect a new member during receipt readback. It is not waived or
reported as a passing regression here.
