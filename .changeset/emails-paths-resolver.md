---
"@hasna/emails": patch
---

Switch @hasna/emails local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/emails` data root (with the `HASNA_EMAILS_HOME` / `EMAILS_HOME` exact-app overrides layered on top of the existing `HASNA_EMAILS_DB_PATH` / `EMAILS_DB_PATH` store overrides) stays the effective data root until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The postinstall data-directory hardening and the config/credentials, workflow-event, and provider-keyring locations all resolve through the effective data root. The dependency is pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
