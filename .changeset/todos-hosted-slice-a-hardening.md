---
"@hasna/todos": patch
---

Harden the hosted MCP slice by preserving template assignees and task-list bindings, binding exact-agent reads to validated response identities, removing placeholder claims, pushing bounded dependency pagination into the storage adapters and generated `/v1` SDK, and refusing unsupported commit and verification timestamps instead of dropping them.
