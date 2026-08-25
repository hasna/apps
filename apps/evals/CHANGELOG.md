# Changelog

## 0.2.7

### Patch Changes

- Updated dependencies [85a5e06]
  - @hasna/contracts@0.14.1

## 0.2.6

### Patch Changes

- Updated dependencies [6176948]
- Updated dependencies [7575de8]
  - @hasna/contracts@0.14.0

## 0.2.5

### Patch Changes

- 8b70821: evals-serve answers --version/-V/--help before any bind (todos row 7e5f8f3d). Previously `evals-serve --version`/`--help` fell through to startEvalsServer() and bound :19440 with no output.

## 0.2.4

### Patch Changes

- Updated dependencies [554a5b9]
  - @hasna/contracts@0.13.4

## 0.2.3

### Patch Changes

- d7d615b: Pin @hasna/contracts to a published version (was ^0.13.0; 0.13.0 is unpublished, which makes the standard-suite conformance validator cannot-run) and align the declared contracts kit per member. Todos d175d558. The ship-latest version wave advanced the pin to 0.13.3.
  - @hasna/contracts@0.13.3

## 0.2.2

### Patch Changes

- Updated dependencies [5e32853]
  - @hasna/contracts@0.13.2

## 0.2.1

### Patch Changes

- 0d4f749: Add `prepack: bun run build` so `npm pack` and `npm publish` ship the built `dist` that each package's `main` points to. Previously only `prepublishOnly` built, so a clean-clone `npm pack` shipped a tarball with no code. Also add a repo-root `.editorconfig` with the member-standard style (2-space indent, LF, final newline).
- Updated dependencies [d5b64f8]
- Updated dependencies [1da0550]
  - @hasna/contracts@0.13.0

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Generic `ValidationPlan` and `ProofBundle` SDK outputs backed by the canonical
  `@hasna/contracts` schemas and validators. Eval-specific metadata records
  deterministic assertions, LLM judge details, artifact references, per-case
  verdicts, residual risks, verifier identity, and freshness without copying
  provider API keys or judge reasoning.
- GitHub Actions now runs the typecheck and full test suite on pull requests and
  pushes to `main`.

### Fixed

- Test-only module mocks no longer leak into later integration tests when the full
  suite runs in one Bun process.

### Changed

- Enabled TypeScript checks for implicit returns and switch fallthrough.

### Removed

- Unused `chalk` runtime dependency.

## [0.2.0] - 2026-07-27

### Removed

- **BREAKING:** `evals sync push`, `evals sync pull` and `evals sync status`. The
  commands existed only to copy the local SQLite eval store into a shared Postgres
  through a retired dependency that no longer has a maintained home, so they are
  deleted rather than reimplemented. Local eval history in `~/.hasna/evals/evals.db`
  is unaffected — `evals runs` and `evals compare` keep working exactly as before.
- The retired shared-cloud runtime dependency, which nothing else in the package used.
  `src/db/store.ts` already owns its own `bun:sqlite` connection (including
  `PRAGMA journal_mode=WAL` and `PRAGMA foreign_keys=ON`), so no replacement was needed.
- `sync` from the bash and zsh completion scripts.

### Added

- `src/no-cloud-boundary.test.ts` regression guard: fails if a manifest, any lockfile,
  a shipped source file or a built artifact reintroduces the retired dependency, or if
  the CLI/MCP/library entry points grow a cloud-sync surface again. The built-output
  check reads every file under `dist/` and `dashboard/dist/` regardless of extension,
  because bundling leaves no import specifier to match and a reference can land in a
  sourcemap or a non-JavaScript chunk. On `main` the package really was bundled into
  two shipped artifacts (`dist/cli/index.js`, `dist/mcp/index.js`); removing it takes
  `dist/cli/index.js` from 1,267,809 to 888,211 bytes.

### Changed

- The completion test now derives its expectations from the CLI's own `--help` output
  and asserts that completions advertise no command the CLI does not register — the
  failure mode that let a stale `sync` entry ship.
- `prepublishOnly` builds before it tests. It previously tested first, which left the
  built-output half of the guard scanning a stale or absent `dist/` at the one moment
  it has to be armed: publish. This repo has no CI workflow, so `prepublishOnly` is
  the only automated gate.

## [0.1.20] - 2026-04-02

### Added

- `evals generate` now supports `-j, --json` to output a machine-readable generation summary

### Changed

- Added CLI help coverage for `generate --help` JSON flag visibility

## [0.1.19] - 2026-04-02

### Added

- `evals doctor` now supports machine-readable `--json` / `-j` output with `ok`, `checks`, and `summary`
- Added `renderMarkdownDiff` unit coverage for markdown-native compare output

### Changed

- `evals compare --markdown` now prints markdown diff sections instead of ANSI terminal diff lines
- Added short `-j` aliases for JSON output on `run`, `estimate`, `compare`, `doctor`, `ci run`, and `judge`

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
