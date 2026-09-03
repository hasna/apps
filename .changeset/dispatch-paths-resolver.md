---
"@hasna/dispatch": patch
---

Switch @hasna/dispatch local path reads/writes through the in-package resolver (XDG/macOS home layout). The legacy `~/.hasna/dispatch` data dir (with the `DISPATCH_DATA_DIR` exact-app override) stays the effective data dir until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The install-time postinstall now creates the same effective data dir the runtime resolves. The wave-wide resolver dependency (`@hasna/paths@0.1.0`) was deleted 2026-09-03 (hasna/apps#1535); the resolver is now implemented locally in-package.
