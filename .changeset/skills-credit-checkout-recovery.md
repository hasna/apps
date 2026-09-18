---
"@hasna/skills": patch
---

Preserve caller-owned credit checkout idempotency keys across SDK, CLI and MCP, including bounded unresolved-response errors. Explicit retries retain the same key; no automatic checkout retry is performed.
