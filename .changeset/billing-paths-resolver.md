---
"@hasna/billing": patch
---

Switch @hasna/billing local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/billing` default (with the `HASNA_BILLING_HOME` / `BILLING_HOME` exact-app overrides) stays the effective home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The dependency is pinned exactly to `@hasna/paths@0.2.1` (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
