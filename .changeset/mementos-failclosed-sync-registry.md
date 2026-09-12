---
"@hasna/mementos": patch
---

Fail-closed: close the two on-box store bypasses that survived the 0.15 gate
(fleet alignment 2026-09-11, T1 §3.5 mementos).

- `storage push|pull|sync|status` (CLI) and the `storage_*` MCP tools built
  `new SqliteAdapter(getDbPath())` directly, bypassing `getDatabase()`'s
  fail-closed gate: on a hosted station they created and read
  `~/.hasna/mementos/mementos.db`. They now refuse with
  `REMOTE_COMMAND_UNSUPPORTED` naming the opt-in (`HASNA_MEMENTOS_LOCAL=1` or an
  explicit `HASNA_MEMENTOS_DB_PATH`) unless the process is the server or the
  local opt-in is in force. Nothing is created on the hosted route.
- The MCP session registry lived at the HOME ROOT (`~/.open-sessions-registry.db`)
  and was created ungated by every `mementos-mcp` start, hosted or not. It now
  exists as a file only under the local opt-in / server context, beside the
  memory store (`<store dir>/sessions-registry.db`, `:memory:` for a `:memory:`
  store), and is process-local (in-memory, same API) on the hosted route — the
  auto-inject orchestrator and channel pusher keep working; no file is written.
- Tests pin a scratch store + the local opt-in before importing the registry, so
  the suite never touches a real machine's files; a new hosted-route test proves
  no `*.db*` appears under HOME for either module.
