---
"@hasna/conversations": patch
---

Switch @hasna/conversations local path reads/writes through the in-package resolver (XDG/macOS home layout). The legacy `~/.hasna/conversations` data root (with the `HASNA_CONVERSATIONS_HOME` / `CONVERSATIONS_HOME` exact-app overrides layered on top of the existing `HASNA_CONVERSATIONS_DB_PATH` / `CONVERSATIONS_DB_PATH` store override) stays the effective data root until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The install-time postinstall now creates the same effective data root (and its `training` subdir) the runtime resolves. The wave-wide resolver dependency (`@hasna/paths@0.1.0`) was deleted 2026-09-03 (hasna/apps#1535); the resolver is now implemented locally in-package.
