---
"@hasna/computers": patch
---

Switch @hasna/computers local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/computers` data root (with the `HASNA_COMPUTERS_HOME` / `COMPUTERS_HOME` exact-app overrides layered on top of the existing `COMPUTERS_DB` store override) stays the effective data root until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The one-time migration of a cwd-relative `./computers.db` now targets the effective data root. The dependency is pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
