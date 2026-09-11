---
"@hasna/todos": minor
---

Twelve more MCP tools use the hosted `/v1` routes instead of the local store (PORT-TO-API slice A2)

Continues the slice-A rewire with the last `task-project-tools` / `task-auto-tools` / `agents` tools
whose `/v1` route already exists:

- **Task writes** — `reschedule_task` (`PATCH /v1/tasks/{id}`), `bulk_update_tasks`,
  `bulk_create_tasks` (with dependency edges wired through `POST /v1/tasks/{id}/dependencies`),
  `bulk_delete_tasks`. The bulk tools now report the true per-id updated/failed/skipped split from the
  server's answers instead of a local-store count.
- **Reads** — `list_comments` (`GET /v1/tasks/{id}/comments`), `search_tasks` (`GET /v1/tasks?q=`),
  `get_activity_timeline` (`GET /v1/activity`, which explicitly names `run_evidence` as an omitted
  source rather than presenting a narrower timeline as the whole story).
- **Archive** — `archive_completed`, `unarchive_task`, `get_archived_tasks`. `GET /v1/tasks` accepts
  `include_archived`, which the client's query builder was not forwarding, so there had been no way to
  ask the hosted authority for the archived set at all.
- **Workload** — `rebalance_workload` builds its load map from `GET /v1/agents` + `GET /v1/tasks` and
  moves tasks with `PATCH /v1/tasks/{id}`.
- **Agents** — `suggest_agent_name` reads the shared roster, so it stops handing out a name another
  station is already holding.

Each tool keeps its local-store arm behind the unchanged explicit local opt-in, and each has a
hosted-path test asserting the exact route and that no database file is created.
