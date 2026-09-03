---
"@hasna/emails": patch
---

Switch @hasna/emails local path reads/writes through the in-package resolver (XDG/macOS home layout). The legacy `~/.hasna/emails` data root (with the `HASNA_EMAILS_HOME` / `EMAILS_HOME` exact-app overrides layered on top of the existing `HASNA_EMAILS_DB_PATH` / `EMAILS_DB_PATH` store overrides) stays the effective data root until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The postinstall data-directory hardening and the config/credentials, workflow-event, and provider-keyring locations all resolve through the effective data root. The wave-wide resolver dependency (`@hasna/paths@0.1.0`) was deleted 2026-09-03 (hasna/apps#1535); the resolver is now implemented locally in-package.
