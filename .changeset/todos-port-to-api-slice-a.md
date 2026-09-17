---
"@hasna/todos": minor
---

MCP tools now use the hosted `/v1` routes instead of the local store (PORT-TO-API slice A)

Thirty-two MCP tools reached `src/db/*` directly and had no hosted arm at all, so on a
station whose credential points at the hosted authority they answered from that machine's
private SQLite file — while the matching CLI verbs were already remote-only. The two doors
disagreed on the same station. Each of these now calls the real `/v1` route through the
existing todos client:

- **Templates (12)** — `create_template`, `list_templates`, `create_task_from_template`,
  `delete_template`, `update_template`, `init_templates`, `preview_template`,
  `export_template`, `import_template`, `template_history` now use
  `GET|POST /v1/templates`, `GET|PATCH|DELETE /v1/templates/{id}`,
  `GET /v1/templates/{id}/history` and `POST /v1/templates/initialize`.
  `list_template_library` and `write_template_library` answer from the bundled static
  library and no longer drag `bun:sqlite` in behind them.
- **Tasks (7)** — `upsert_task` (`POST /v1/tasks/upsert`), `claim_task`
  (`POST /v1/tasks/{id}/start`), `release_task` and `extend_task`
  (`GET` + `PATCH /v1/tasks/{id}`, revision-checked), `get_comments`
  (`GET /v1/tasks/{id}/comments`), `list_my_tasks` (`GET /v1/tasks`), `standup`
  (the shared recap over `/v1/tasks`, `/v1/dependencies` and `/v1/agents`).
- **Queue analytics (7)** — `get_my_workload`, `notify_upcoming_deadlines`,
  `get_sla_breaches`, `get_stale_tasks`, `get_blocked_tasks`, `get_blocking_tasks`
  compute from `GET /v1/tasks` + `GET /v1/dependencies`; `run_doctor` reports
  `GET /v1/integrity` and refuses `apply` on the hosted authority rather than
  pretending a client-side repair happened.
- **Git trail and verification (7)** — `link_task_to_commit`, `get_task_commits`,
  `find_task_by_commit`, `link_task_git_ref`, `get_task_git_refs`,
  `find_tasks_by_git_ref`, `add_task_verification` use
  `/v1/tasks/{id}/{commits,refs,verifications}`, `/v1/commits/{sha}` and `/v1/refs/{ref}`.
- **Agents (1)** — `get_agent` resolves against the shared roster on
  `GET /v1/agents/{id}` instead of 404ing every cloud-only agent.

The local-store arm of each tool is unchanged and still reachable behind the existing
explicit local opt-in. The remote reusable-template implementation that was private to the
CLI `template*` commands moved to `src/cli/template-remote.ts` so both surfaces run one
implementation rather than two. New hosted-path tests drive every ported tool against a
real in-process `/v1` origin and assert no database file is created.
