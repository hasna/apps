# Shared task queries

Applies to `@hasna/todos` 0.16.0 (CLI). Not a local-mode break: an explicit
`HASNA_TODOS_LOCAL=1` run still serves these five commands from the local store.

`todos mine <agent>`, `blocked`, `overdue`, `today`, and `yesterday` now work through saved API credentials. They read the shared authority and do not open the default SQLite database. Explicit local storage usage remains available for legacy library/fixture compatibility.

`mine` unions the server's assigned-agent and creating-agent queries and deduplicates identities. `blocked` checks each pending task's prerequisites, using the shared blocking-status policy (completed/cancelled prerequisites do not block). An unreadable prerequisite produces an error instead of an authoritative-looking empty result. `overdue` excludes archived and terminal tasks and includes subtasks. The two day views include subtasks and preserve their activity groups and local-day boundaries; labels use the caller’s local calendar date, with updates included from midnight up to (but excluding) the next local midnight, including daylight-saving changes. Stored timestamps without an offset are interpreted as UTC consistently with the task API.

Pass `--project` to scope a query; project names/IDs resolve against the shared registry. Without it these API queries read across shared projects. They do not create a project from the caller's working directory. No task or project writes occur.

Every task query requires the API's `tasks` and `total` envelope and follows offset pages to completion. Changing totals, duplicate identities, stalled pages, scope mismatches or more than 10,000 rows fail visibly; narrow a large query with `--project`. Multiple reads are not a transactional snapshot. Older APIs that omit pagination evidence require a server upgrade; there is no local fallback.

This closes only the five named CLI commands. The broader local-only inventory (including `ready`'s explicit source-store discovery and the remaining administrative and MCP families) still requires conversion and acceptance before any database is retired. This patch performs no migration, deployment or deletion, and does not alter the existing single-corpus task-adapter security boundary.
