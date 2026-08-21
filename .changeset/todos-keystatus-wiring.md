---
"@hasna/todos": patch
---

Fix the 0.15.38 /v1 503 (row ae34a051, incident 720366): wire `keyStatus: store.keyStatus` instead of the deprecated `isRevoked`-only hook, which @hasna/contracts >= 0.8.7 refuses at verifier construction — the #761 lockfile regeneration moved todos from the stale-locked contracts 0.5.2 to 0.13.1, so every /v1 business route returned HTTP 503 with a valid key while /health and /version stayed 200. Regression tests: `src/server/cloud-auth-wiring.test.ts` (default lane) and `src/server/cloud-auth-wiring.pg.test.ts` (TODOS_TEST_PG_URL lane).
