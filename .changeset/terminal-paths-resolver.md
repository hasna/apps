---
"@hasna/terminal": patch
---

Switch @hasna/terminal local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/terminal` data home (with the `HASNA_TERMINAL_DIR` / `TERMINAL_DIR` exact-app overrides) stays the effective data home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The `~/.terminal` forward-migration is preserved, and the install-time `postinstall` that hardcoded `$HOME/.hasna/terminal/...` is removed (the data home and its subdirectories are created lazily by the resolver path). The dependency is pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
