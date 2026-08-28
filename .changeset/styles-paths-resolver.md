---
"@hasna/styles": patch
---

Switch @hasna/styles local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/styles` default (with the `HASNA_STYLES_HOME` / `STYLES_HOME` exact-app overrides) stays the effective home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The pre-`.hasna` legacy dirs (`.open-styles`, `.styles`) still copy-forward into the effective root; the install-time postinstall now provisions that same effective root instead of hard-coding `~/.hasna/styles`. The dependency is pinned exactly to `@hasna/paths@0.1.0` (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
