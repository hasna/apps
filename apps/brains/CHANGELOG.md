# Changelog

## 0.0.36

### Patch Changes

- 0d4f749: Add `prepack: bun run build` so `npm pack` and `npm publish` ship the built `dist` that each package's `main` points to. Previously only `prepublishOnly` built, so a clean-clone `npm pack` shipped a tarball with no code. Also add a repo-root `.editorconfig` with the member-standard style (2-space indent, LF, final newline).

## Unreleased

- ci: run typechecking, builds, and tests on pull requests and pushes to `main`.

## 0.0.35 — 2026-07-24

- fix(cli): compact default CLI and MCP output (#1) — collections, data, finetune, and
  models commands now emit compact, human-readable summaries by default with a shared
  compact-output helper; MCP tool responses trimmed to match. Release cut to publish the
  merged #1 changes (npm 0.0.34 predated #1).
