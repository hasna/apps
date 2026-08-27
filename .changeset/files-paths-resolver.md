---
"@hasna/files": patch
---

Switch @hasna/files local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/files` data root (with the `HASNA_FILES_DATA_DIR` / `FILES_DATA_DIR` and `HASNA_FILES_HOME` / `FILES_HOME` exact-app overrides) stays the effective data root until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The SQLite store (`files.db`), `config.json`, the Google Drive connector token store, the ops-loop snapshot root, and the postinstall data-dir provisioning all resolve through the effective data root, and the one-time `~/.files` auto-migration now targets the effective root. The dependency is pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
