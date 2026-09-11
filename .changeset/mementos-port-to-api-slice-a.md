---
"@hasna/mementos": minor
---

Memory locks, session ingestion and the synthesized profile now use the hosted
`/v1` API instead of the on-box SQLite file (PORT-TO-API slice A).

Under a hosted credential these surfaces reached local SQLite even though the
server already served the matching route, so on a station they either failed
closed or silently answered from an empty local file:

- **Memory locks** — the MCP tools `memory_lock`, `memory_unlock` and
  `memory_check_lock` now reach `POST /v1/locks`, `DELETE /v1/locks/:id` and
  `GET /v1/locks`. `src/lib/memory-lock.ts` was building a local database
  handle and passing it down, which defeated the hosted arm `src/db/locks.ts`
  already had — so two agents on different machines could not see each other's
  memory locks. `agentHoldsLock` answers from the hosted lock list.
- **Session ingestion** — `mementos session ingest|status|list` and the MCP
  tools `memory_ingest_session`, `memory_session_status`, `memory_session_list`
  now post to `POST /v1/sessions/ingest`, which queues the extraction on the
  server; the client no longer starts a local queue worker or polls a local
  store, and the queue stats come from `GET /v1/sessions/queue/stats`.
- **Synthesized profile** — `mementos synthesized-profile` and the MCP tool
  `memory_profile` call `POST /v1/profile/synthesize`. The server owns the
  corpus and the LLM spend; a station no longer needs an `ANTHROPIC_API_KEY` to
  read its own profile. Marking a cached profile stale also goes through the
  hosted memory routes instead of an `UPDATE` against a local database.

Also adds hosted-path regression tests for the synthesis run/status/history/
rollback surfaces that #1899 moved to `/v1`, so `synthesis run|status|rollback`,
`memory_synthesize`, `memory_synthesis_status`, `memory_synthesis_history` and
`memory_synthesis_rollback` are now covered by a test that fails if the client
ever reads the local store again.

No behaviour changes for a local (`HASNA_MEMENTOS_LOCAL=1`) install: every
local arm is unchanged and still selected the same way.
