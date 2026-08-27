---
"@hasna/machines": patch
---

Switch @hasna/machines local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/machines` data root (with the `HASNA_MACHINES_HOME` / `MACHINES_HOME` exact-app overrides layered on top of the pre-existing `HASNA_MACHINES_DIR`) stays the effective data root until the store has actually been migrated to the XDG data home (`machines.db` present there) or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing live store never becomes invisible on upgrade. The per-file `HASNA_MACHINES_*_PATH` overrides are preserved and layered on top. The install-time postinstall now provisions the same effective data root the runtime resolves instead of hardcoding `$HOME/.hasna/machines`. Nothing moves on disk in this phase.
