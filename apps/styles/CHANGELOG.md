# Changelog

## 0.1.18

### Patch Changes

- ac86329: Switch @hasna/styles local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/styles` default (with the `HASNA_STYLES_HOME` / `STYLES_HOME` exact-app overrides) stays the effective home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The pre-`.hasna` legacy dirs (`.open-styles`, `.styles`) still copy-forward into the effective root; the install-time postinstall now provisions that same effective root instead of hard-coding `~/.hasna/styles`. The dependency is pinned exactly to `@hasna/paths@0.1.0` (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
- Updated dependencies [8e7403f]
- Updated dependencies [94e6de9]
  - @hasna/events@0.1.18
  - @hasna/paths@0.2.3

## 0.1.17

### Patch Changes

- Switch @hasna/styles local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/styles` default (with the `HASNA_STYLES_HOME` / `STYLES_HOME` exact-app overrides) stays the effective home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME`. The pre-`.hasna` legacy dirs (`.open-styles`, `.styles`) still copy-forward into the effective root; the install-time postinstall now provisions that same effective root. The dependency is pinned exactly to `@hasna/paths@0.1.0`.

## 0.1.16

### Patch Changes

- 0d4f749: Add `prepack: bun run build` so `npm pack` and `npm publish` ship the built `dist` that each package's `main` points to. Previously only `prepublishOnly` built, so a clean-clone `npm pack` shipped a tarball with no code. Also add a repo-root `.editorconfig` with the member-standard style (2-space indent, LF, final newline).
- styles-mcp now answers `--version` / `--help` immediately instead of entering MCP stdio mode (bind-before-version fix).

## Unreleased

- Run install, typecheck, build, and tests in GitHub Actions for pull requests
  and pushes to `main`.

## 0.1.15

- Publish the compact CLI/MCP output feature merged in PR #1: list/status/detail
  CLI commands and MCP tools are now compact by default with bounded rows,
  truncation, pagination (`--limit`/`--cursor`/`nextCursor`), `--verbose`, and
  explicit `--json` full-output paths. Adds compact summary MCP resources
  (`styles://registry/summary`, `styles://summary/{name}`) alongside full-detail
  compatibility resources, plus `format.ts` helpers and README guidance.
  (Version bump only; source already on `main` via #1.)

## 0.1.14

- Clean styles package bin metadata; tighten release gate; remove cloud
  dependency; report package version; migrate legacy data dirs; prevent template
  output path escapes; resolve built-in active profile refs.
