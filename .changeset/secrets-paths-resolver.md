---
"@hasna/secrets": patch
---

Switch @hasna/secrets local path reads/writes through the in-package resolver (XDG/macOS home layout). The operator vault data dir (vault.db, key material, aws.json, aws-sync-state.json) now resolves through `dataDir({app:"secrets"})` with gated legacy adoption: the legacy `~/.hasna/secrets` home stays the effective default until the store has actually been migrated to the XDG data home (`~/.local/share/hasna/secrets` on Linux, `~/Library/Application Support/Hasna/secrets` on macOS) or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local vault never becomes invisible on upgrade. The `~/.secrets` env-file bridge (import-env/export-env) is a separate legacy credential store and is deliberately unchanged. Install-time dir creation (postinstall) follows the same resolution. The wave-wide resolver dependency (`@hasna/paths@0.1.0`) was deleted 2026-09-03 (hasna/apps#1535); the resolver is now implemented locally in-package.
