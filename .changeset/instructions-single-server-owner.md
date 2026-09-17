---
"@hasna/instructions": patch
---

Keep `instructions-serve` under one explicit Bun listener so the production task does not auto-serve the exported Hono app a second time and exit with `EADDRINUSE`.
