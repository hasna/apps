# @hasna/treasury

## 0.1.5

### Patch Changes

- Republish after the 0.1.4 registry unpublish (2026-08-28): 0.1.4 is blocked by npm's 72-hour window, so the reviewed content ships as 0.1.5. Content identical to the reviewed 0.1.4 candidate (paths-resolver home migration, exact-home override precedence aligned with postinstall, consumed changeset dropped).

## 0.1.4

### Patch Changes

- Switch @hasna/treasury local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/treasury` default (with the `HASNA_TREASURY_HOME` / `TREASURY_HOME` exact-app overrides and the `HASNA_TREASURY_DB_PATH` / `TREASURY_DB_PATH` db-path overrides) stays the effective data home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The install-time postinstall now provisions the same effective home (root + config/data/exports/backups/logs/tmp subdirs, mode 0700) instead of hardcoding `~/.hasna/treasury`. Dependency pinned exactly to `@hasna/paths@0.1.0` (XDG home migration, hotfixes plan 0f49f56a, task P3.3).

## 0.1.3

### Patch Changes

- 8b70821: treasury-mcp answers --help/-h before any transport (todos row 7e5f8f3d). Previously `treasury-mcp --help` fell through the --version guard and printed nothing (silent-empty family on help); --version already worked.
