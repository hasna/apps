# @hasna/catalog

## 0.2.2

### Patch Changes

- Switch @hasna/catalog local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/catalog` default (with the `CATALOG_HOME` / `CATALOG_DB_PATH` exact-app overrides) stays the effective home until the store is actually migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. (XDG home migration, hotfixes plan 0f49f56a, task P3.3.)

## 0.2.1

### Patch Changes

- 14115e3: Fix pre-existing scaffold defects surfaced by the hygiene coverage corpus (BUG b87f5915): VERSION constant now matches package.json (0.2.1); blank/whitespace-only CATALOG_* env values fall back to the documented defaults and valid values are trimmed; the shared rollout event-type allowlist is frozen so callers cannot widen it; the HTTP handler contains store failures as a bounded JSON 500 instead of leaking internals.
