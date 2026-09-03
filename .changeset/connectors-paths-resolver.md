---
"@hasna/connectors": patch
---

Switch @hasna/connectors local path reads/writes through the in-package resolver (XDG/macOS home layout). The legacy `~/.hasna/connectors` default (with the `HASNA_CONNECTORS_DIR` exact-app override) stays the effective data home until the store has actually been migrated to the XDG data home (`connectors.db` present there) or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing live store never becomes invisible on upgrade. The wave-wide resolver dependency (`@hasna/paths@0.1.0`) was deleted 2026-09-03 (hasna/apps#1535); the resolver is now implemented locally in-package.
