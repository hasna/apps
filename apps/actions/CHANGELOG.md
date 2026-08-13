# Changelog

All notable changes to `@hasna/actions` are documented here.

## 0.2.0

### Breaking

- **The default `ActionsClient` store is now SQLite.** `new ActionsClient()` without an
  explicit `store` opens `~/.hasna/actions/actions.db` (or `<dataDir>/actions.db`)
  instead of the JSON files, matching the `sqlite` storage engine declared in
  `hasna.contract.json`.
- **The default store requires the Bun runtime.** SQLite is backed by `bun:sqlite`, so
  `engines.bun >= 1.0.0` is now declared. Consumers importing `@hasna/actions`,
  `@hasna/actions/sdk`, or `@hasna/actions/storage` from Node must pass an explicit
  `store: new JsonActionsStore()`; the default store throws
  `SQLiteActionsStore requires the Bun runtime because bun:sqlite is unavailable; use JsonActionsStore instead`.
  The module graph itself stays Node-loadable — no entry point imports a `bun:` builtin
  at module scope.

### Changed

- Added CI checks for typechecking, building, and testing on pull requests and pushes
  to `main`.
- **One-time import of legacy JSON records.** The first time the SQLite store opens a
  data directory it imports existing `manifests.json`, `runs.json`, and
  `audit-events.json` records inside a single immediate transaction, using
  `INSERT OR IGNORE` so newer database rows are never overwritten. The legacy files are
  left in place; writes after the import go to SQLite only, so a downgraded client no
  longer sees new records. A legacy file that cannot be read — truncated, hand edited, or
  half synced — never blocks the store: the path is reported on stderr, the remaining
  files still import, and the migration stays open so the repaired file is picked up on a
  later open.
- Aligned the repository with `@hasna/contracts@0.8.1`: added `hasna.contract.json`,
  the `repo:conformance` and `scan:artifact` release checks, and a `prepack` gate.
- Data directory and database permissions (`0700`/`0600`) are now tightened on a best
  effort basis, so data directories that reject `chmod` stay usable.

## 0.1.6

### Changed

- **Reconcile `main` to the published npm line.** `main` had diverged: npm `latest`
  was `0.1.5` (published 2026-06-29) while `origin/main` was still `0.1.0` and had
  never received the `0.1.1`–`0.1.5` bumps. The published `0.1.5` code lived only on
  `feature/first-action-layer` (PR #1), and no git tags existed for any published
  version. This release merges the published `0.1.5` line into `main` (no-ff,
  preserving both histories) so that future fixes target the actually-deployed code.
  - Verified `feature/first-action-layer` (`b5cff00`) is byte-for-byte identical to
    the published `@hasna/actions@0.1.5` tarball (`dist/` diff clean) before merging;
    backfilled the missing `v0.1.5` tag at that commit.
  - Conflicts resolved in favor of the deployed (published) code.
  - Kept the additive docs contributed on `main` (`CONTRIBUTING.md`, `SECURITY.md`).
  - Removed the incompatible alternate contract-package design (`src/manifest.ts` and
    its tests, `src/mcp/capabilities.ts`) from the tree; those commits remain in git
    history via the no-ff merge (no commits lost).
- Version bumped above the published line (`0.1.5` → `0.1.6`); `src/version.ts` kept
  in sync with `package.json`.

## 0.1.5

- Last version published to npm prior to the reconciliation (2026-06-29). See the
  `feature/first-action-layer` history for the `0.1.1`–`0.1.5` changes (compact
  action CLI/MCP outputs, project dashboard capabilities, action queue contracts).

## 0.1.0

- Initial `open-actions` contract package scaffold.
