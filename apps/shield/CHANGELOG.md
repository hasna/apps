# @hasna/shield

## 0.1.31

### Patch Changes

- 2efbc1b: Switch @hasna/shield local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/security` data root (with the new `HASNA_SHIELD_HOME` exact-app override, and the existing `SECURITY_DB` per-file db-path override layered on top) stays the effective data root until the store has been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing live store never becomes invisible on upgrade. The store folder is named `security`, not `shield` — `~/.hasna/security` has been shield's data root since its own `~/.hasna/shield` -> `~/.hasna/security` consolidation — so the resolver app slug is `security` and the XDG data home is `~/.local/share/hasna/security`. The install-time postinstall provisions the same effective data root instead of hardcoding `$HOME/.hasna/security`. Dependency pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
- Updated dependencies [8e7403f]
- Updated dependencies [94e6de9]
  - @hasna/events@0.1.18
  - @hasna/paths@0.2.3

## 0.1.30

### Patch Changes

- Switch @hasna/shield local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/security` data root (with the new `HASNA_SHIELD_HOME` exact-app override, and the existing `SECURITY_DB` per-file db-path override layered on top) stays the effective data root until the store has been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing live store never becomes invisible on upgrade. The store folder is named `security`, not `shield` — `~/.hasna/security` has been shield's data root since its own `~/.hasna/shield` -> `~/.hasna/security` consolidation — so the resolver app slug is `security` and the XDG data home is `~/.local/share/hasna/security`. The install-time postinstall provisions the same effective data root instead of hardcoding `$HOME/.hasna/security`. Dependency pinned exactly to `@hasna/paths@0.1.0`.

## 0.1.29

### Patch Changes

- 2b87a81: Hermeticize six test suites (21a04472): economy ingest/sync tests stash the ambient Accounts API key, testers CLI/MCP tests stash the ambient Testers API env, attachments stash ambient API/todos keys and split the server harness out of the test file, shield routes CRUD modules through a db-access seam, hooks disable ambient core.hooksPath for fixture commits, markdown skips the per-package lockfile this monorepo layout does not have, and testers pins @hasna/browser to the published 0.5.29.

## 0.1.28

### Patch Changes

- d7d615b: Pin @hasna/contracts to the published 0.13.1 (was ^0.13.0; 0.13.0 is unpublished, which makes the standard-suite conformance validator cannot-run) and align hasna.contract.json kitVersion to the declared contracts kit 0.13.1. Todos d175d558.
