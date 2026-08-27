---
"@hasna/events": patch
---

Switch @hasna/events local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/events` default (with the `HASNA_EVENTS_DIR` / `HASNA_EVENTS_HOME` exact-app overrides) stays the effective data home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The dependency is pinned exactly to `@hasna/paths@0.1.0` (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
