---
"@hasna/monitor": patch
---

Switch @hasna/monitor local path reads/writes through the in-package resolver (XDG/macOS home layout). The legacy `~/.hasna/monitor` default (with the `MONITOR_CONFIG_DIR` / `HASNA_MONITOR_HOME` exact-app overrides) stays the effective home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The wave-wide resolver dependency (`@hasna/paths@0.1.0`) was deleted 2026-09-03 (hasna/apps#1535); the resolver is now implemented locally in-package.
