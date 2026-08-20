---
"@hasna/contracts": minor
---

Release 0.12.0: the truthful minor bump for the deployment-mode removal. The public `./server-backend` export no longer ships `assertNoLegacyStorageMode` and the kit backend template drops the legacy `storage.mode` guard (net of #418, #503, #544) — a consumer-visible API change that the previous 0.11.2 patch line incorrectly described as "no functional change" (adversarial review P1, 2026-08-20). Also folds in the wave #670 contracts-split entry and the wave-602 smoke-tooling repair (#671). Per the fleet-wide modes-removal directive the guard is not restored; the minor bump records the API change.
