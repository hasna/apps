# @hasna/messages

## 0.2.2

### Patch Changes

- Switch local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/messages` data root (with the `HASNA_MESSAGES_HOME` exact-app override layered on top of the existing `HASNA_MESSAGES_SQLITE_PATH` store override) stays the effective data root until the store has been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. Dependency pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).

## 0.2.1

### Patch Changes

- Updated dependencies [85a5e06]
  - @hasna/contracts@0.14.1

## 0.2.0

### Minor Changes

- 0ca2687: feat: scaffold @hasna/messages v0.1.0 — direct agent-to-agent messaging with threads (task 8c6b7978). Four surfaces (CLI `messages`, MCP `messages-mcp`, HTTP API `messages-serve`, SDK `./sdk`) over one domain implementation in `src/service.ts`; per-recipient delivery state (stored -> delivered -> read), native thread list/expand/unread/close-reopen, first-class agent identity; storage backend SQLite by default or PostgreSQL via `HASNA_MESSAGES_DATABASE_URL` (two-backend contract, no mode enums). messages owns DMs + DM-threads only; channels are conversations' domain.

### Patch Changes

- Updated dependencies [6176948]
- Updated dependencies [7575de8]
  - @hasna/contracts@0.14.0

## 0.1.0 — 2026-08-24

Initial scaffold: direct agent-to-agent messaging with threads.
Four surfaces (CLI, MCP, `-serve` HTTP API, `./sdk` client) over one domain
implementation. SQLite default backend, PostgreSQL via
`HASNA_MESSAGES_DATABASE_URL`. Manifest: `hasna.contract.json`.
