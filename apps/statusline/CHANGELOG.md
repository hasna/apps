# Changelog

All notable changes to `@hasna/statusline` are documented here.

## 0.0.2 - 2026-07-24

- Compact `statusline list` output by default: enabled rows first, row caps,
  totals, and hints to detail paths (#1).
- Add gradual-disclosure paths: `show`/`inspect`, `search`, and the `--verbose`,
  `--json`, `--limit`, `--all`, `--enabled`, `--disabled`, `--search` flags (#1).
- Make the git-branch segment test independent of a hard-coded local path/branch (#1).
- Extend test coverage toward 100% (#4).

## 0.0.1

- Initial release: composable statusline CLI with pre-built toggleable segments,
  provider model, SDK exports, and MCP server.
