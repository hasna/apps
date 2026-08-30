# Changelog

## 0.2.11

### Patch Changes

- 2dbedb3: Switch @hasna/telephony local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The telephony data home (SQLite store and audio output) is resolved as `~/.local/share/hasna/telephony` on Linux and `~/Library/Application Support/Hasna/telephony` on macOS, adopted only once the store has actually been migrated there or the operator sets the data-kind override `HASNA_DATA_HOME` — the legacy `~/.hasna/telephony` default stays the effective home until then, so an existing local store never becomes invisible on upgrade. The dependency is pinned exactly to `@hasna/paths@0.1.0` (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
- Updated dependencies [8e7403f]
- Updated dependencies [94e6de9]
  - @hasna/events@0.1.18
  - @hasna/paths@0.2.3

## 0.2.10

### Patch Changes

- Switch @hasna/telephony local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The telephony data home (SQLite store and audio output) is resolved as `~/.local/share/hasna/telephony` on Linux and `~/Library/Application Support/Hasna/telephony` on macOS, adopted only once the store has actually been migrated there or the operator sets the data-kind override `HASNA_DATA_HOME` — the legacy `~/.hasna/telephony` default stays the effective home until then, so an existing local store never becomes invisible on upgrade. (XDG home migration, hotfixes plan 0f49f56a, task P3.3.)
