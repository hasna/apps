# @hasna/consolidations

## 0.1.4

### Patch Changes

- Switch @hasna/consolidations local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/consolidations` default (with the `HASNA_CONSOLIDATIONS_HOME` / `CONSOLIDATIONS_HOME` exact-app overrides) stays the effective data home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The dependency is pinned exactly to `@hasna/paths@0.1.0` (XDG home migration, hotfixes plan 0f49f56a, task P3.3).

## 0.1.3

### Patch Changes

- 2ea3b9a: fix: the packed tarball no longer carries account-id-shaped 12-digit runs (publish-guard pattern aws-account-id, row 27d2a7a2). The carry was a bundled dependency constant — zod's nil-UUID regex (v4/core/regexes.js). Fix: externalize zod in the member build (zod remains a declared runtime dependency, so runtime behavior is unchanged), and add a per-member publish-guard regression that packs the tarball and scans it with the guard's pattern set (red before, green after).

## 0.1.2

### Patch Changes

- c5d7ba1: First release of the absorbed monorepo app: the registry refuses to republish
  0.1.0 (published then unpublished on 2026-08-15, version claim burned), so this
  ships 0.1.1 — the contract-kit 0.10.6 remediation from PR #379 plus the version
  correction.
- dc1ccce: fix(serve): answer `--version`/`-V` and `--help`/`-h` before binding a socket
  
  The serve bin used to ignore argv and go straight to `Bun.serve`, so
  `consolidations-serve --help` hung with no output. It now prints usage or the
  version and exits 0 without binding (recordings pattern), with regression tests
  covering all four flags.
