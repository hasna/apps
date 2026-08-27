# @hasna/orgs

## 0.1.2

### Patch Changes

- Switch local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/orgs` data root (with the `HASNA_ORGS_HOME` exact-app override, and the existing `OPEN_ORGS_STORE` / `OPEN_ORGS_AUDIT` file-level overrides layered on top) stays the effective data root until the store has been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. Dependency pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).

## 0.1.1

### Patch Changes

- d98bdb7: Sol-guided coverage wave: 29 new tests across node discrimination and graph validation, atomic store mutation and lock ownership, slug/routing/init, snapshot markdown and delegation, and CLI add groups/verbs/failure paths. Two pinned-gap repairs: normalizeGraphData now trims padded names and defaults member displayName (imported members previously misclassified as teams), and delegation-target dedupe now merges scopes and dispatch targets into a unique union.
