# @hasna/access

## 0.1.6

### Patch Changes

- Switch @hasna/access local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/access` home (with the `HASNA_ACCESS_HOME` / `ACCESS_HOME` exact-app overrides) stays the effective home until the store is actually migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The dependency is pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes. (XDG home migration, hotfixes plan 0f49f56a, task P3.3.)

## 0.1.5

### Patch Changes

- d7d615b: Align hasna.contract.json kitVersion to the declared contracts kit 0.13.1 (the pinned @hasna/contracts version). Todos d175d558.

## 0.1.4

### Patch Changes

- 4d6e8c2: fix(access): `access-serve --help`/`--version` answer before binding (the serve entry previously ignored both flags and bound the port unconditionally, hanging instead of answering help; binds-before-args class, BUG row 2920eed6). The plain serve path is unchanged.

## 0.1.3

### Patch Changes

- 70e4dd8: First release from the hasna/apps monorepo. The package was imported from hasna/access with history preserved (import commit 4582814); there are no functional changes since 0.1.1 — the delta is the import itself plus the monorepo workspace wiring. This patch establishes version ownership under the monorepo.
