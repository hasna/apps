# @hasna/paths

## 0.2.1

### Patch Changes

- 111360e: `paths --version` and `paths --help` now answer before any argument validation (previously `--version` exited 2 as an unknown argument and `--help` exited 2 because the required-`--app` check ran first). The `paths` bin stays execution-free for metadata probes.

## 0.2.0

### Minor Changes

- 3c147f8: Add the package-owned path resolver (@hasna/paths): resolves config/data/state/cache homes honoring HASNA_CONFIG_HOME / HASNA_DATA_HOME / HASNA_STATE_HOME / HASNA_CACHE_HOME overrides and XDG/macOS defaults, with hasna/internal/<app> for internal apps (XDG home migration, hotfixes plan 0f49f56a, tasks P3.1/P3.2). Ships the `paths` CLI and the `./sdk` module.
