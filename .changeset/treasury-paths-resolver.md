---
"@hasna/treasury": patch
---

Switch @hasna/treasury local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/treasury` default (with the `HASNA_TREASURY_HOME` / `TREASURY_HOME` exact-app overrides and the `HASNA_TREASURY_DB_PATH` / `TREASURY_DB_PATH` db-path overrides) stays the effective data home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The install-time postinstall now provisions the same effective home (root + config/data/exports/backups/logs/tmp subdirs, mode 0700) instead of hardcoding `~/.hasna/treasury`. The dependency is pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
