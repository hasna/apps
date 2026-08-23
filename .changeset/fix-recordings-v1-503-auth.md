---
"@hasna/recordings": patch
---

Wire the contracts `keyStatus` hook in the /v1 server: `verifyApiKey` no longer throws at construction (contracts 0.9.0+ refuses the deprecated `isRevoked`-only wiring eagerly), so every authenticated read path (GET /recordings, GET /stats, …) stops returning 503 "authentication service unavailable" while /health and /version stayed 200. Denied requests now also emit a `[recordings-serve] auth deny` warn carrying the kid and reason.
