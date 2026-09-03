---
"@hasna/orgs": patch
---

Switch @hasna/orgs local path reads/writes through the in-package resolver (XDG/macOS home layout). The legacy `~/.hasna/orgs` data root (with the `HASNA_ORGS_HOME` exact-app override, and the existing `OPEN_ORGS_STORE` / `OPEN_ORGS_AUDIT` file-level overrides layered on top) stays the effective data root until the store has been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The wave-wide resolver dependency (`@hasna/paths@0.1.0`) was deleted 2026-09-03 (hasna/apps#1535); the resolver is now implemented locally in-package.
