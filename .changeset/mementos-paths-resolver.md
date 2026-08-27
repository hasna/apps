---
"@hasna/mementos": patch
---

Switch @hasna/mementos local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout, hotfixes plan 0f49f56a task P3.3). The legacy `~/.hasna/mementos` data root stays the effective data root until the store has actually been migrated to the XDG data home (`mementos.db` present there) or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing live store never becomes invisible on upgrade. The exact-app overrides `HASNA_MEMENTOS_HOME` / `MEMENTOS_HOME` win unconditionally, and the per-file `HASNA_MEMENTOS_DB_PATH` / `MEMENTOS_DB_PATH` overrides are preserved and layered on top. The install-time postinstall now provisions the same effective data root the runtime resolves instead of hardcoding `$HOME/.hasna/mementos`. Nothing moves on disk in this phase.
