# Hasna Notes and the Notes Server — Single-Server Model

**Removal note (0.2.0).** Multi-machine sync machinery was removed from the
CLI, the macOS app, and the server: the `notes sync` / `cloud` / `billing`
verbs, the sync daemon and service install (`sync --watch`,
`--install-service`), the GUI `SyncScheduler`, sync-state handling
(`sync-state.json`, `sync-status.json`), the machine manifest and the
Machines UI surface, and the server's `/api/v1/sync` endpoint with its
`sync_batches` table. There is no machine sync anymore — no daemon, no
scheduling, no cross-machine convergence.

What remains is the single-server model: the notes client is a plain HTTP API
client speaking the `personalnotes/v1` wire dialect to exactly one notes
server. **The dialect itself is unchanged and is not renamed** — the future
hosted SaaS wrapper speaks the same protocol, so the names and shapes below
are the contract.

## How a client talks to its notes server

The client connects to one server over HTTP. The server base URL is the only
switch: `HASNA_NOTES_API_URL` (or config `apiUrl`). `HASNA_NOTES_API_KEY` is
the bearer credential for the self-hosted server. A configured URL without a
key fails closed — the client never proceeds unauthenticated and never guesses
a server.

```
HASNA_NOTES_API_URL=http://127.0.0.1:8788    # the self-hosted server default
HASNA_NOTES_API_KEY=pn_...                   # required for server calls
```

## The server (self-hosted)

`bunx notes-server` runs the reference server: Hono + SQLite by default
(`~/.hasna/notes/server.db`); set `HASNA_NOTES_DATABASE_URL` to
run on PostgreSQL instead. The server exposes the `personalnotes/v1` dialect
surface:

- `GET  /api/v1/discovery` — dialect + version
- `POST /api/v1/auth/*` — OTP and device-code login
- `GET/POST/PATCH/DELETE /api/v1/notes[/:id]` — CRUD with soft delete
- `POST /api/v1/export` — full export feed

The sync round-trip endpoint (`POST /api/v1/sync`) is gone. Notes flow between
a client and its server through the CRUD and export endpoints of the dialect.

## What was removed, and why

The old sync story synchronized the local markdown store with the server in
both directions on a schedule, from any number of machines. The multi-machine
machinery that made that possible — the sync engine and its state file, the
daemon, the service installer, the GUI timer, the machine manifest, the
Machines dropdown, and the server's idempotent batch table — is removed per
the owner directive for the 2026-08 notes cloud transition. The client is now
a plain HTTP API client, and the server stores notes for exactly the server
that owns them.
