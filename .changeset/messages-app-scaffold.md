---
"@hasna/messages": minor
---

feat: scaffold @hasna/messages v0.1.0 — direct agent-to-agent messaging with threads (deployment task 81671594). Four surfaces (CLI `messages`, MCP `messages-mcp`, HTTP API `messages-serve` on port 8081, SDK `./sdk`) over one domain implementation in `src/service.ts`; storage backend SQLite by default or PostgreSQL via `HASNA_MESSAGES_DATABASE_URL` (two-backend contract, no mode enums). Deployed into the internal harness on AWS (ECS Fargate, RDS PostgreSQL, messages.hasna.xyz).
