---
"@hasna/messages": minor
---

feat: scaffold @hasna/messages v0.1.0 — direct agent-to-agent messaging with threads (task 8c6b7978). Four surfaces (CLI `messages`, MCP `messages-mcp`, HTTP API `messages-serve`, SDK `./sdk`) over one domain implementation in `src/service.ts`; per-recipient delivery state (stored -> delivered -> read), native thread list/expand/unread/close-reopen, first-class agent identity; storage backend SQLite by default or PostgreSQL via `HASNA_MESSAGES_DATABASE_URL` (two-backend contract, no mode enums). messages owns DMs + DM-threads only; channels are conversations' domain.
