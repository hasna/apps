---
"@hasna/mementos": patch
---

Fix every command to work in ANY transport (hosted API via the credentials
file, or local SQLite) — the storage-mode axis is retired (owner directive
2026-08-15). Transport-gated breakage removed:

- `synthesis run` / `synthesis rollback` crashed in hosted mode with the
  split-brain guard; they now route to the server (`POST /synthesis/run`,
  `POST /synthesis/rollback/:run_id`).
- `session ingest` crashed in hosted mode; the transcript now ships to the
  server-side queue (`POST /sessions/ingest`).
- `backup` in hosted mode snapshot a stale local island or failed with
  "Database not found"; it now captures the cloud population through the API
  into the same portable format `restore` reads, so backup → restore
  round-trips in both transports (and overwriting an existing destination path
  behaves like the local arm instead of failing on a UNIQUE conflict).
- `mementos-serve` no longer consults the client resolver: `isApiMode()` is
  false in the server process, so a serve spawned from a shell exporting
  `HASNA_MEMENTOS_API_URL`/`HASNA_MEMENTOS_API_KEY` keeps serving its own
  backend instead of crashing or routing writes at the shared cloud.
- Credential-hermeticity suites now pin a fixture home/config-home, so they
  never resolve the operator's real `~/.hasna/mementos/config/credentials`.