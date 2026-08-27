---
"@hasna/context": patch
---

Switch @hasna/context local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/context` data home (with the `HASNA_CONTEXT_DATA_DIR` / `CONTEXT_DATA_DIR` exact-app overrides layered on top of the existing `HASNA_CONTEXT_DB_PATH` / `CONTEXT_DB_PATH` store overrides) stays the effective data home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The dependency is pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
