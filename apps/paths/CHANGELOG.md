# @hasna/paths

## 0.2.2

### Patch Changes

- 94e6de9d4: Fail closed on an unknown path kind. `baseDir` previously returned `undefined` and `resolvePath` threw a cryptic `The "paths[0]" property must be of type string` from `node:path` when a JS caller or runtime misconfiguration passed a value outside `config | data | state | cache`. Both now throw a clear `TypeError` naming the invalid kind. The `PathKind` union still protects TypeScript callers; this closes the silent-undefined failure class at the resolver boundary (published as 0.2.2 from the ship lane without the bump reaching main; landed here to reconcile src with npm — H8-00510).

## 0.2.1

### Patch Changes

- 111360e: `paths --version` and `paths --help` now answer before any argument validation (previously `--version` exited 2 as an unknown argument and `--help` exited 2 because the required-`--app` check ran first). The `paths` bin stays execution-free for metadata probes.

## 0.2.0

### Minor Changes

- 3c147f8: Add the package-owned path resolver (@hasna/paths): resolves config/data/state/cache homes honoring HASNA_CONFIG_HOME / HASNA_DATA_HOME / HASNA_STATE_HOME / HASNA_CACHE_HOME overrides and XDG/macOS defaults, with hasna/internal/<app> for internal apps (XDG home migration, hotfixes plan 0f49f56a, tasks P3.1/P3.2). Ships the `paths` CLI and the `./sdk` module.
