---
"@hasna/skills": patch
---

Switch @hasna/skills local path reads/writes through the in-package resolver (XDG/macOS home layout). The legacy `~/.hasna/skills` data root (with the `HASNA_SKILLS_DIR` / `HASNA_SKILLS_HOME` / `SKILLS_HOME` exact-app overrides) stays the effective home until the store has actually been migrated to the XDG data home (`server.db` / `config.json` present there) or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The wave-wide resolver dependency (`@hasna/paths@0.1.0`) was deleted 2026-09-03 (hasna/apps#1535); the resolver is now implemented locally in-package.
