# @hasna/messages

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
