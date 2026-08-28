---
"@hasna/test-guard": patch
---

Switch @hasna/test-guard local guard-home reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/test-guard` home (with the `HASNA_TEST_GUARD_DIR` / `SENTINEL_GUARD_DIR` exact-app overrides) stays the effective home until the guard state has actually been migrated to the XDG state home or the operator sets the state-kind override `HASNA_STATE_HOME` — an existing guard install never becomes invisible on upgrade. `sentinel.sh` and `bun-wrapper.sh` now resolve their guard-home default through the resolver CLI (`paths --app test-guard --kind state`, `@hasna/paths@0.1.0` pinned exactly), falling back to the legacy home when the resolver is unavailable or the resolved home is not adopted. battery section 19 + the hermetic smoke regress adoption, the legacy fallback, the empty-home non-adoption guard, the `HASNA_STATE_HOME` override, and the no-resolver fallback. (XDG home migration, hotfixes plan 0f49f56a, task P3.3.)
