# @hasna/holdings

## 0.1.7

### Patch Changes

- Switch @hasna/holdings local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/holdings` app home (with the `HASNA_HOLDINGS_HOME` / `HOLDINGS_HOME` exact-app overrides and the `HASNA_HOLDINGS_DB_PATH` / `HOLDINGS_DB_PATH` db-path overrides) stays the effective data home until the store is actually migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The legacy postinstall mkdir of `~/.hasna/holdings` is removed; the runtime ensures the effective home on first use. (XDG home migration, hotfixes plan 0f49f56a, task P3.3.)

## 0.1.6

### Patch Changes

- 8b70821: holdings-mcp answers --help/-h before any transport (todos row 7e5f8f3d). Previously `holdings-mcp --help` fell through the --version guard and printed nothing (silent-empty family on help); --version already worked.

## 0.1.5

### Patch Changes

- 2ea3b9a: fix: packed tarballs no longer carry account-id-shaped 12-digit runs (publish-guard pattern aws-account-id, row 27d2a7a2). The carries were bundled dependency constants — zod's nil-UUID regex and pg-types' binary-parser date offset. Fixes: externalize zod/pg in the member builds (each remains a declared runtime dependency, so runtime behavior is unchanged), and add a per-member publish-guard regression that packs the tarball and scans it with the guard's pattern set (red before, green after).

## 0.1.4

### Patch Changes

- d7d615b: Pin @hasna/contracts to the published 0.13.1 (was ^0.13.0; 0.13.0 is unpublished, which makes the standard-suite conformance validator cannot-run) and align hasna.contract.json kitVersion to the declared contracts kit 0.13.1. Todos d175d558.

## 0.1.3

### Patch Changes

- 0d4f749: Add `prepack: bun run build` so `npm pack` and `npm publish` ship the built `dist` that each package's `main` points to. Previously only `prepublishOnly` built, so a clean-clone `npm pack` shipped a tarball with no code. Also add a repo-root `.editorconfig` with the member-standard style (2-space indent, LF, final newline).
