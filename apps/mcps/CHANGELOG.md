# @hasna/mcps

## 0.0.32

- Switch local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout), pinned exactly to `@hasna/paths@0.1.0`.
- The legacy `~/.hasna/mcps` home stays the effective data home until the store is migrated to the XDG data home or `HASNA_DATA_HOME` is set — an existing local store never becomes invisible on upgrade.
- `mcps export --file` default resolves under the effective data home; the legacy postinstall mkdir of the cache dir is removed (the runtime ensures the effective home on first use).
