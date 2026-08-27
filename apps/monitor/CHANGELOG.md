# @hasna/monitor

## 0.1.29

### Patch Changes

- Switch @hasna/monitor local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/monitor` default (with the `MONITOR_CONFIG_DIR` / `HASNA_MONITOR_HOME` exact-app overrides) stays the effective home until the store is actually migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. (XDG home migration, hotfixes plan 0f49f56a, task P3.3.)

## 0.1.28

### Patch Changes

- 5d826683b1: feat(monitor): slug definition schema and machine-checkable predicates (MON-V2-01) (#480)
- eb1525a439: feat(monitor): v2 persistence — migration 008 and slug repository (MON-V2-02) (#482)
- fbf0ac26bc: feat(monitor): durable queue, leases, fencing, and terminal receipts (MON-V2-03) (#483)
- 3497e76612: chore(monitor): align @hasna/hooks dep to the 0.7.0 line (#737)
- Updated dependencies [3497e76612]
  - @hasna/events@0.1.16
  - @hasna/hooks@0.7.0
