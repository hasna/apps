# @hasna/mcps

## 0.0.33

### Patch Changes

- b3f6433: Switch @hasna/mcps local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/mcps` app home (with the `HASNA_MCPS_DATA_DIR` / `MCPS_DATA_DIR` exact-app overrides, the `HASNA_MCPS_DB_PATH` / `MCPS_DB_PATH` db-path overrides, and the `~/.mcps` -> `~/.hasna/mcps` auto-migration) stays the effective data home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The `mcps export --file` default now resolves under the effective data home instead of a hardcoded `~/.hasna/mcps`, and the legacy postinstall mkdir of `$HOME/.hasna/mcps/cache` is removed — the runtime ensures the effective home and its cache on first use. The dependency is pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
- Updated dependencies [8e7403f]
- Updated dependencies [94e6de9]
  - @hasna/events@0.1.18
  - @hasna/paths@0.2.3

## 0.0.32

- Switch local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout), pinned exactly to `@hasna/paths@0.1.0`.
- The legacy `~/.hasna/mcps` home stays the effective data home until the store is migrated to the XDG data home or `HASNA_DATA_HOME` is set — an existing local store never becomes invisible on upgrade.
- `mcps export --file` default resolves under the effective data home; the legacy postinstall mkdir of the cache dir is removed (the runtime ensures the effective home on first use).
