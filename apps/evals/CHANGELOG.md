# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.18] - 2026-04-02

### Fixed
- Shell completion scripts now include the `sync` command for both bash and zsh output
- Added CLI regression test to ensure completion output stays aligned with available top-level commands

## [0.1.14] - 2026-04-02

### Added
- 179 unit tests across 14 test files (assertions, judge, runner, all adapters, reporter, store, CLI, MCP server, E2E pipeline)
- `evals mcp register` command with `--claude`, `--codex`, `--gemini`, `--all` flags (replaces broken `evals mcp --claude`)
- Auto-resolve `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` from `~/.secrets` when not in environment (fixes doctor + judge in non-shell contexts)
- Multi-path example dataset resolution in `evals doctor` (works globally installed)
- `--module`, `--export`, `--command`, `--mcp-command`, `--tool` options on `evals run` and `evals ci run`
- `evals sync push/pull/status` commands via `@hasna/cloud` SDK
- Shell completion: `evals completion bash` / `evals completion zsh`
- React SPA dashboard served by `evals-serve`
- Pass^k metric (`repeat: N`, `passThreshold`) on eval cases
- Multi-turn eval cases (`turns[]` array)
- Nightly cron script at `~/.local/bin/open-evals-sync.sh` (auto-commit + pull + test)

### Fixed
- `--no-judge` flag parsed incorrectly (Commander boolean vs string)
- `evals mcp --claude` was invalid Commander subcommand name
- `evals doctor` example dataset path wrong when globally installed
- OpenAI v6 `tool_calls` type change (`function` property access)

### Changed
- Upgraded all dependencies to latest: `@anthropic-ai/sdk@0.82`, `openai@6`, `zod@4`, `commander@14`, `typescript@6`, `@modelcontextprotocol/sdk@1.29`, `@hasna/cloud@1.30`

## [0.1.0] - 2026-03-27

### Added
- Initial implementation: 20+ assertion types, LLM-as-judge (CoT-before-verdict, PASS/FAIL/UNKNOWN), 6 adapters (http, anthropic, openai, mcp, function, cli), eval runner with parallel execution, dataset loader (JSONL/JSON), SQLite store, reporter (terminal/JSON/markdown), full CLI, MCP server with 8 tools
