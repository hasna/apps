---
"@hasna/calendar": patch
---

Fix the 0.3.6 /v1 503 (row I38-00755, deploy-oss-fleet-0823a confirm 725517): wire `keyStatus: store.keyStatus` instead of the deprecated `isRevoked`-only hook, which @hasna/contracts >= 0.8.7 refuses at verifier construction — the 0.3.6 lockfile regeneration moved calendar from @hasna/contracts ^0.4.2 to the pinned 0.13.3, so every /v1 business route returned HTTP 503 with a valid key while /health and /version stayed 200. Same contracts isRevoked-only class as the @hasna/todos 0.15.38 incident (row ae34a051, incident 720366, hasna/apps#769). Regression tests: `src/server/cloud-auth-wiring.test.ts` (default lane) and `src/server/cloud-auth-wiring.pg.test.ts` (CALENDAR_TEST_DATABASE_URL lane).
