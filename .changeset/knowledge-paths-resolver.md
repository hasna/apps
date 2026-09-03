---
"@hasna/knowledge": patch
---

Switch @hasna/knowledge local path reads/writes through the in-package resolver (XDG/macOS home layout). The legacy `~/.hasna/knowledge` home (with the `HASNA_KNOWLEDGE_HOME` exact-app override) stays the effective home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The resolver covers the global store home, the project-scoped `projects/<key>` sub-root, and the auth store default; the per-app override `HASNA_KNOWLEDGE_AUTH_DIR` is unchanged. The wave-wide resolver dependency (`@hasna/paths@0.1.0`) was deleted 2026-09-03 (hasna/apps#1535); the resolver is now implemented locally in-package.
