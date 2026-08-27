# @hasna/feedback

## 0.3.2

### Patch Changes

- Switch @hasna/feedback local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/feedback` default (with the `HASNA_FEEDBACK_HOME` / `FEEDBACK_HOME` exact-app overrides) stays the effective data home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The dependency is pinned exactly to `@hasna/paths@0.1.0` (XDG home migration, hotfixes plan 0f49f56a, task P3.3).

## 0.3.1

### Patch Changes

- cdbe90d: First release from the hasna/apps monorepo. The package was imported from hasna/feedback with history preserved (import capsule 14c6f83d, import merge bae42ff3e); there are no functional changes since 0.3.0 — the delta is the import itself plus the monorepo workspace wiring and the documented absorption deviations (stale `.project.json` marker removed, trailing-blank-line normalization on 4 files). This patch establishes version ownership under the monorepo.
- Updated dependencies [b630c48]
  - @hasna/events@0.1.16
