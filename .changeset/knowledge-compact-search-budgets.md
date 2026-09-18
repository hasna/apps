---
"@hasna/knowledge": minor
---

Add additive compact/full/legacy detail modes for Knowledge CLI and MCP search responses. Compact search rows return bounded text previews, compact context search removes duplicated raw result bodies when excerpts are present, and compact MCP JSON is minified. Existing response contracts remain available by omitting `detail` or selecting `legacy`, while `full` explicitly requests complete text.

Enforce both token and UTF-8 byte ceilings for local and hosted context packs. Context-pack receipts now report the configured and measured byte budgets, and refuse instead of returning a successful over-budget payload.
