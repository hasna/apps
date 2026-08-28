---
"@hasna/workflows": patch
---

Switch @hasna/workflows local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/workflows` default (with the `HASNA_WORKFLOWS_DATA_DIR` / `WORKFLOWS_DATA_DIR` exact-app overrides) stays the effective data home until the store has actually been migrated to the XDG data home (`workflows.db` exists there) or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The dependency is pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
