---
"@hasna/workflows": patch
---

Switch @hasna/workflows local path reads/writes through the in-package resolver (XDG/macOS home layout). The legacy `~/.hasna/workflows` default (with the `HASNA_WORKFLOWS_DATA_DIR` / `WORKFLOWS_DATA_DIR` exact-app overrides) stays the effective data home until the store has actually been migrated to the XDG data home (`workflows.db` exists there) or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The wave-wide resolver dependency (`@hasna/paths@0.1.0`) was deleted 2026-09-03 (hasna/apps#1535); the resolver is now implemented locally in-package.
