---
"@hasna/holdings": patch
---

Switch @hasna/holdings local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/holdings` app home (with the `HASNA_HOLDINGS_HOME` / `HOLDINGS_HOME` exact-app overrides and the `HASNA_HOLDINGS_DB_PATH` / `HOLDINGS_DB_PATH` db-path overrides) stays the effective data home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The legacy postinstall mkdir of `~/.hasna/holdings` is removed; the runtime ensures the effective home on first use. The dependency is pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
