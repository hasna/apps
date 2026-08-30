# Changelog

## 4.3.22

### Patch Changes

- 413c7f5: Switch @hasna/terminal local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/terminal` data home (with the `HASNA_TERMINAL_DIR` / `TERMINAL_DIR` exact-app overrides) stays the effective data home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The `~/.terminal` forward-migration is preserved, and the install-time `postinstall` that hardcoded `$HOME/.hasna/terminal/...` is removed (the data home and its subdirectories are created lazily by the resolver path). The dependency is pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
- Updated dependencies [8e7403f]
- Updated dependencies [94e6de9]
  - @hasna/events@0.1.18
  - @hasna/paths@0.2.3

## [4.3.21] - 2026-08-29

### Changed

- Republication past the registry-protected 4.3.20 slot (4.3.20 was published
  2026-08-28 and the package fully unpublished 2026-08-28, so its npm slot is
  permanently burned). 4.3.21 carries the identical 4.3.20 changeset.

## [4.3.20] - 2026-08-28

### Changed

- Switch local path reads/writes through the @hasna/paths resolver (XDG/macOS
  home layout). The legacy `~/.hasna/terminal` data home (with the
  `HASNA_TERMINAL_DIR` / `TERMINAL_DIR` exact-app overrides) stays the
  effective data home until the store has been migrated to the XDG data home
  or the operator sets `HASNA_DATA_HOME` — an existing local store never
  becomes invisible on upgrade. The `~/.terminal` forward-migration is
  preserved; the install-time `postinstall` that hardcoded
  `$HOME/.hasna/terminal/...` is removed (the data home and its subdirectories
  are created lazily). Dependency pinned exactly to `@hasna/paths@0.1.0`.

## [4.3.19] - 2026-08-18

### Changed

- Republication past the registry-protected 4.3.18 slot (4.3.18 was published
  in the standalone-repo era and fully unpublished 2026-08-15, so its npm slot
  is permanently burned). 4.3.19 carries the identical 4.3.18 changeset.

## [4.3.18] - 2026-08-14

### Changed

- Removed the retired shared cloud MCP helper registration and dependency from
  the terminal package.
- Replaced the README legacy sync section with the terminal-owned local storage
  boundary.
- Added source and packed-artifact no-cloud release gates.
- Fixed secret-scan findings in the imported terminal subtree (credential-pattern
  hygiene in shipped files and docs).

This is a patch release because the shared cloud helper is being retired across
the open-source package set; terminal-owned functionality remains local and the
MCP server still exposes the terminal-native tool groups.

## [4.3.17] - 2026-06-27

### Changed

- Migrated terminal legacy files into the existing data directory.

## [4.3.16] - 2026-06-27

### Changed

- Migrated the terminal legacy data directory to the canonical `~/.hasna/terminal`
  location.

## [4.3.15] - 2026-07-07

### Changed

- Hardened MCP command timeouts (bounded exec windows with explicit timeouts).
- Compacted CLI and MCP output defaults — gradual disclosure for list and status
  commands.
- Redacted snapshot environment values.

## [0.7.0] - 2026-03-15

### Added

- `terminal exec` command — smart execution for AI agents with full pipeline
- Claude Code PostToolUse hook installer (`t hook install --claude`)
- Command rewriter (auto-optimizes find, git log, npm ls, ps aux, etc.)
- Lazy execution for large result sets (>100 lines → count + sample)
- `--help` and `--version` flags

## [0.6.0] - 2026-03-15

### Added

- Noise stripping pipeline (npm fund, progress bars, gyp, blank lines)
- Fuzzy diff threshold (>80% similarity → diff-only, not just exact match)
- Progressive disclosure (`expand` MCP tool — summary first, details on demand)
- `read_symbol` MCP tool (read a function by name, not the whole file — 88% savings)

## [0.5.0] - 2026-03-15

### Added

- AI-powered output processor (Cerebras qwen-3-235b summarization)
- Session file cache with change detection
- Search overflow guard (auto-truncate + suggest narrower pattern)
- `symbols` CLI and MCP tool for file structure outline
- `repo_state` MCP tool (git status + diff + log in one call)
- `repo` and `symbols` CLI commands

## [0.4.0] - 2026-03-15

### Added

- Semantic code search with AST parsing (`search_semantic` MCP tool)
- Enhanced smart display with ls -la compression and date range collapsing

### Fixed

- Use qwen-3-235b exclusively (llama3.1-8b too unreliable)
- Project context detection in system prompt

## [0.3.0] - 2026-03-15

### Added

- SQLite session tracking for all terminal interactions
- `sessions`, `sessions stats`, `sessions <id>` CLI commands
- `session_history` MCP tool

## [0.2.0] - 2026-03-15

### Added

- Multi-provider support (Cerebras + Anthropic)
- Structured output parsers (ls, find, git, test, build, npm, errors)
- Token compression engine with budget mode
- MCP server with 16+ tools
- Smart search with auto-filtering and relevance ranking
- Reusable command recipes with collections and projects
- Process supervisor for background commands
- Diff-aware output caching
- Token economy tracker
- Session snapshots for agent handoff
- Smart display (path grouping, node_modules collapse, pattern dedup)

## [0.1.5] - 2026-03-14

### Added

- Tabs, browse mode, fuzzy history, ghost text, cd awareness

## [0.1.0] - 2026-03-13

### Added

- Initial release — natural language terminal with Anthropic
