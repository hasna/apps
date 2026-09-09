---
"@hasna/conversations": patch
---

Every command and MCP tool now works in every transport: `events-drain`, `admin redact-messages` and MCP `send_feedback` gained hosted API paths (`POST /v1/events/outbox/drain`, `POST /v1/admin/redact-messages`, `POST /v1/feedback`), the interactive TUI is Store-backed end to end, and the legacy local-mode-only gates plus the `LOCAL mode` notice wording are retired — the on-box store remains reachable only by the explicit opt-in (`HASNA_CONVERSATIONS_DB_PATH` / `CONVERSATIONS_DB_PATH`), never by default (hasna/apps#1897).