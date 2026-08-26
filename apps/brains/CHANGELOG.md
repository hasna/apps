# Changelog

## 0.0.39

### Patch Changes

- babcde3: Switch @hasna/brains local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/brains` default (with the `HASNA_BRAINS_DIR` / `HASNA_BRAINS_HOME` exact-app overrides) stays the effective home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The dependency is pinned exactly to `@hasna/paths@0.2.1` (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
  - @hasna/paths@0.2.1

## 0.0.38

### Patch Changes

- Switch @hasna/brains local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/brains` default (with the `HASNA_BRAINS_DIR` / `HASNA_BRAINS_HOME` exact-app overrides) stays the effective home until the store is actually migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. (XDG home migration, hotfixes plan 0f49f56a, task P3.3.)

## 0.0.37

### Patch Changes

- 723e08c: Add legacy provider compatibility for the tinker rename. The pre-0.0.36 `thinker-labs` provider value and `THINKER_LABS_API_KEY` / `THINKER_LABS_BASE_URL` env vars are accepted and normalized to `tinker` / `TINKER_*` at the CLI, MCP, and schema boundaries; persisted rows that stored `thinker-labs` remain visible and updatable (`models list --provider tinker` matches both spellings, MCP status probes the legacy row id form, `models import` stores the canonical spelling). Canonical config always wins over the legacy spelling at any level. README carries the migration note; the 0.0.36 changelog entry documents the full change set (provider rename, read-after-write fix, storage-mode removal, terminology cleanup, prepack build).

## 0.0.36

### Patch Changes

- 0d4f749: Add `prepack: bun run build` so `npm pack` and `npm publish` ship the built `dist` that each package's `main` points to. Previously only `prepublishOnly` built, so a clean-clone `npm pack` shipped a tarball with no code. Also add a repo-root `.editorconfig` with the member-standard style (2-space indent, LF, final newline).
- c59f2bf: Rename the fine-tuning provider from "thinker-labs" to "tinker" (provider value, `TINKER_API_KEY` / `TINKER_BASE_URL` env vars). The legacy provider spelling and legacy env vars remain accepted and are normalized at the CLI, MCP, and schema boundaries, so existing configurations and persisted rows keep working.
- 6766fec: Fix a models read-after-write race. `getDb()` now shares one connection per resolved `BRAINS_DB_PATH`, so a write and a follow-up read resolve to the same database instead of separate in-memory stores (fixes a recurring CI flake and a 404-after-insert on the server path).
- 70f274984: Remove the deployment-mode storage vocabulary. Retired `HASNA_BRAINS_STORAGE_MODE` / `BRAINS_STORAGE_MODE` variables now fail loud instead of selecting a mode; the server backend is selected solely by `HASNA_BRAINS_DATABASE_URL` presence (`postgresql`) or its absence (`sqlite`). `brains storage status` reports `Backend:` instead of `Mode:`.
- eeb08ff0: Retire the `open-*` terminology from source comments and docs; provider docs now use the canonical `@hasna/*` naming.

## Unreleased

- ci: run typechecking, builds, and tests on pull requests and pushes to `main`.

## 0.0.35 — 2026-07-24

- fix(cli): compact default CLI and MCP output (#1) — collections, data, finetune, and
  models commands now emit compact, human-readable summaries by default with a shared
  compact-output helper; MCP tool responses trimmed to match. Release cut to publish the
  merged #1 changes (npm 0.0.34 predated #1).
