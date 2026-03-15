# Changelog

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
