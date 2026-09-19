---
"@hasna/todos": minor
---

Make residual MCP project, task-list, plan, and agent collections compact, continuation-bearing, field-capped, and 32 KiB-bounded by default, with explicit safety-bounded full/all compatibility. Canonical opaque cursors bind exact filters, stable identity ordering, the prior boundary, and a complete snapshot fingerprint so tampering or mutation refuses continuation. Return plan and task-list metadata plus truthful task counts by default and require explicit bounded nested task pagination whose final outer response also stays within 32 KiB. Canonicalize the fleet inventory on `https://api.hasna.com/todos`, make `todos-serve` require either a PostgreSQL DSN or explicit local-only mode, and remove the companion SDK's implicit localhost fallback.
