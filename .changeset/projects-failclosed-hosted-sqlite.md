---
"@hasna/projects": minor
---

Fail closed under a hosted credential: no on-box SQLite, ever (owner ruling
2026-09-07, hasna/apps#1720; supersedes the `projects-allcmds` branch #1893,
which made SQLite the no-credential default).

- Once the ambient environment resolves a hosted Projects authority, the
  process refuses every open of `~/.hasna/projects/projects.db` and of a
  per-project `data/<id>/project.db` (`refuseLocalStore` choke point in
  `getDatabase()` and the project.db openers). The refusal is
  `REMOTE_COMMAND_UNSUPPORTED`, names the authority, the credential tiers and
  the `HASNA_PROJECTS_LOCAL=1` opt-in, never a value.
- The hosted store no longer falls through to machine-local SQLite for project
  data models/records, loop links, `store inspect`'s app store and tmux
  profiles; like budgets/spend they throw the exported
  `LocalOnlyOperationError` (`code: REMOTE_COMMAND_UNSUPPORTED`). Nothing
  configured still fails closed; `HASNA_PROJECTS_LOCAL=1` is the only route to
  the on-box store.
- `projects store ensure <wks_id>` on the hosted backend provisions the folder
  layout only (`app_store: null`), never creates `project.db`, and takes its
  mutation lock through `/v1/locks` instead of the local `workspace_locks`
  table. `store inspect` reports `app_store: null` + `app_store_unavailable`.
- `start`, `cleanup-create`, `cleanup-evals`, `agent-eval` and the MCP
  `projects_start`/`projects_render_start` no longer mint an on-box CLI agent
  row under a hosted credential (attribution is server-side). A hosted
  `create --dry-run` previews against an in-memory scratch registry.
- `projects update --canonical-machine <slug>` is validated against the
  machines registry first and names the registered slugs (the hosted API
  rejects unknown slugs with HTTP 400 "Machine not found"). The storage
  client is now built from the enriched transport, so every hosted error
  carries the server's reason (`… -> 400: Machine not found: station03`)
  instead of a bare status.
