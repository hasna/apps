---
"@hasna/dispatch": patch
---

Switch @hasna/dispatch local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/dispatch` data dir (with the `DISPATCH_DATA_DIR` exact-app override) stays the effective data dir until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The install-time postinstall now creates the same effective data dir the runtime resolves. The dependency is pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
