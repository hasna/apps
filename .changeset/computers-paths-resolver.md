---
"@hasna/computers": patch
---

Switch @hasna/computers local path reads/writes through the in-package resolver (XDG/macOS home layout). The legacy `~/.hasna/computers` data root (with the `HASNA_COMPUTERS_HOME` / `COMPUTERS_HOME` exact-app overrides layered on top of the existing `COMPUTERS_DB` store override) stays the effective data root until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The one-time migration of a cwd-relative `./computers.db` now targets the effective data root. The wave-wide resolver dependency (`@hasna/paths@0.1.0`) was deleted 2026-09-03 (hasna/apps#1535); the resolver is now implemented locally in-package.
