---
"@hasna/feedback": patch
---

Switch @hasna/feedback local path reads/writes through the in-package resolver (XDG/macOS home layout). The legacy `~/.hasna/feedback` data root stays the effective data dir until the store has actually been migrated to the XDG data home (`feedback.db` / `feedback.jsonl` present there) or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The exact-app overrides `HASNA_FEEDBACK_HOME` / `FEEDBACK_HOME` name an explicit root and win, and the legacy `HASNA_FEEDBACK_DATA_DIR` / `FEEDBACK_DATA_DIR` data-dir overrides keep precedence. The postinstall data-directory creation resolves the same effective home. The wave-wide resolver dependency (`@hasna/paths@0.1.0`) was deleted 2026-09-03 (hasna/apps#1535); the resolver is now implemented locally in-package.
