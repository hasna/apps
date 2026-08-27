---
"@hasna/crawl": patch
---

Switch @hasna/crawl local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/crawl` data root (with the `HASNA_CRAWL_HOME` / `CRAWL_HOME` exact-app overrides layered on top of the existing `HASNA_CRAWL_DB_PATH` / `CRAWL_DB_PATH` store overrides) stays the effective data root until the store has actually been migrated to the XDG data home (`data.db` present there) or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing live store never becomes invisible on upgrade. The legacy `~/.open-crawl` and `~/.crawl` auto-migration now targets the effective data root. The dependency is pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
