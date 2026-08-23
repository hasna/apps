---
"@hasna/skills": patch
---

Pin the `./storage` subpath compatibility contract: export `storageCapabilities` (version, values, types) from both `./storage` and the main entrypoint, and add `src/storage-boundary.test.ts`, which imports the subpath like a packed consumer and asserts every contract member is present while the retired deployment-mode surface (`getStorageMode` / `getSkillsStorageMode` / `SkillsStorageMode`) stays absent — so a future removal fails the OSS suite loudly instead of breaking embedders silently, as the 0.1.61 `getStorageMode` removal did. `docs/architecture/upstream-boundary.md` now documents the supported storage contract and the status-function replacement for the removed mode concept.
