---
"@hasna/secrets": patch
---

fix(scanner): package_registry_token fires on npm_ identifiers — align the tail threshold with the fleet-documented value-length standard ({12,} → {20,}, matching tooling/ci/check-secrets.ts and the commit-gate pattern history). The detector matched ordinary names (identifiers ending in packages_seen / global_duplicates) and blocked commits on credential-free files; real npm granular tokens (npm_ + 36 hex) still fire. Regression tests cover both directions (todos 12ccb3a2).
