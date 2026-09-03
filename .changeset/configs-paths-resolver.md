---
"@hasna/instructions": patch
---

Switch @hasna/configs (the `configs` surface of @hasna/instructions — the configs store root) local path reads/writes through the in-package resolver (XDG/macOS home layout). The legacy `~/.hasna/instructions` default (with the `HASNA_CONFIGS_HOME` exact-app override) stays the effective store home until the store has actually been migrated to the XDG config home (`~/.config/hasna/configs` on Linux; `~/Library/Application Support/Hasna/configs` on macOS) or the operator sets the config-kind override `HASNA_CONFIG_HOME` — an existing local store never becomes invisible on upgrade. The wave-wide resolver dependency (`@hasna/paths@0.1.0`) was deleted 2026-09-03 (hasna/apps#1535); the resolver is now implemented locally in-package.
