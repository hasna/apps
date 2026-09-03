---
"@hasna/files": patch
---

Switch @hasna/files local path reads/writes through the in-package resolver (XDG/macOS home layout). The legacy `~/.hasna/files` data root (with the `HASNA_FILES_DATA_DIR` / `FILES_DATA_DIR` and `HASNA_FILES_HOME` / `FILES_HOME` exact-app overrides) stays the effective data root until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The SQLite store (`files.db`), `config.json`, the Google Drive connector token store, the ops-loop snapshot root, and the postinstall data-dir provisioning all resolve through the effective data root, and the one-time `~/.files` auto-migration now targets the effective root. The wave-wide resolver dependency (`@hasna/paths@0.1.0`) was deleted 2026-09-03 (hasna/apps#1535); the resolver is now implemented locally in-package.
