---
"@hasna/tickets": patch
---

Switch @hasna/tickets local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/tickets` default (with the `HASNA_TICKETS_HOME` / `TICKETS_HOME` exact-app overrides) stays the effective home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The pre-`.hasna` legacy `.tickets` store still copy-forwards into the effective root; the install-time postinstall now provisions that same effective root (and its training/ directory) instead of hard-coding `~/.hasna/tickets`. The dependency is pinned exactly to `@hasna/paths@0.1.0` (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
