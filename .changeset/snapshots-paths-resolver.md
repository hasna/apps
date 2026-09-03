---
"@hasna/snapshots": patch
---

Switch @hasna/snapshots local path reads/writes through the in-package resolver (XDG/macOS home layout). The legacy `~/.hasna/snapshots` data home (with the `HASNA_SNAPSHOTS_DIR` exact-app override layered on top of the existing `HASNA_SNAPSHOTS_DB_PATH` store override) stays the effective data home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The default sqlite store path and the install-time provisioning of the exports/logs/plans subdirectories (postinstall.js) now resolve through the effective data home. The wave-wide resolver dependency (`@hasna/paths@0.1.0`) was deleted 2026-09-03 (hasna/apps#1535); the resolver is now implemented locally in-package.
