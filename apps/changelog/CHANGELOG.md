# Changelog

All notable changes to Open Changelog are documented in this file.

## [0.2.0] - 2026-07-06

### Added

- Added `changelog publish --release` and the `publishRelease` SDK entrypoint
  (`@hasna/changelog/release`) for open-releases: accepts appId + version,
  promotes pending entries, writes the changelog, and returns a
  `changelogRef` resource pointer for `hasna.release.v1` documents.
- Added `changelog web` and `generateChangelogSite`
  (`@hasna/changelog/web`): static per-app changelog pages with RSS 2.0 and
  JSON Feed 1.1 feeds, a site index, and a machine-readable `site.json`.
- Added `normalizeAppId` / `parseAppId` / `appIdSchema` validation helpers.

### Changed

- Aligned app ids with the `hasna.app.v1` AppId slug: entry appIds are
  normalized on create/update, npm names are accepted as input
  (`@hasna/todos` -> `open-todos`), and package-based inference now maps
  `@hasna/*` packages to the `open-<name>` repo-folder convention instead of
  stripping the `open-` prefix.
- Pinned the multi-entry `bun build` output root to `src` so dist keeps its
  flat layout as new entrypoints are added.

## [0.1.1] - 2026-07-01

### Added

- Added release promotion for moving `Unreleased` entries into a version/date across SDK, CLI, API, and MCP.
- Added duplicate entry protection with an explicit duplicate override.
- Added publish diff previews and backup-on-write behavior for existing changelog files.
- Added package-based app id inference and repository-aware commit/task link rendering.
- Added semver-aware Markdown version sorting.

## [0.1.0] - 2026-07-01

### Added

- Initial Open Changelog package scaffold with SDK, local JSONL storage, CLI, HTTP API, MCP tools, Markdown generation, publish safety, docs, and tests.
