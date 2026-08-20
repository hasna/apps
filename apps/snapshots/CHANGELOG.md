# Changelog

## 0.1.4

### Patch Changes

- 0d4f749: Add `prepack: bun run build` so `npm pack` and `npm publish` ship the built `dist` that each package's `main` points to. Previously only `prepublishOnly` built, so a clean-clone `npm pack` shipped a tarball with no code. Also add a repo-root `.editorconfig` with the member-standard style (2-space indent, LF, final newline).

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
