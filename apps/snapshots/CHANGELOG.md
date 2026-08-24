# Changelog

## 0.1.6

### Patch Changes

- snapshots freshness now keys off capture-RUN recency (new capture_runs run-record; `snapshots freshness` verb); the deployed wrapper posts an INCIDENT only on a genuine stale or no-runs condition (PR #1076, merged 70cfd556).

## 0.1.5

### Patch Changes

- c574f10: snapshots, snapshots-mcp and snapshots-serve answer --help and --version before any dispatch, transport connect or bind; previously `snapshots --version` printed usage JSON instead of the version, `snapshots-mcp --version` entered stdio mode and printed nothing, and `snapshots-serve --version` ignored argv and bound the HTTP port (todos row cbb7ca3d).

## 0.1.4

### Patch Changes

- 0d4f749: Add `prepack: bun run build` so `npm pack` and `npm publish` ship the built `dist` that each package's `main` points to. Previously only `prepublishOnly` built, so a clean-clone `npm pack` shipped a tarball with no code. Also add a repo-root `.editorconfig` with the member-standard style (2-space indent, LF, final newline).
- 6715109: Add hardening-roadmap validation tooling: `validate:hardening` and `validate:hardening:complete` scripts validate the hardening roadmap ledger (`ops/hardening-roadmap.json`) against its schema, `typecheck` now also checks `tsconfig.scripts.json`, and `check` runs the hardening validation before typecheck/test/build. Source-only additions (docs/ops/scripts/tests); the runtime snapshot/restore layer under `src/` is unchanged.

## 0.1.3 - 2026-07-24

PR-drain release. No runtime/behavioral changes to the snapshot/restore layer since
0.1.2; product source under `src/` is unchanged. Repository and packaging hygiene only:

- CI: add GitHub Actions workflow running typecheck + tests + build, and a `check`
  npm script (`bun run typecheck && bun test && bun run build`) (#2).
- Docs: add SDK usage examples to the README and an LOC audit report (#3).

## 0.1.2

- Add granular snapshot restore controls.

## 0.1.1

- Harden live snapshot restore on macOS.

## 0.1.0

- Initial `@hasna/snapshots` package: runtime snapshot and restore layer for Hasna
  local open-source developer environments.
