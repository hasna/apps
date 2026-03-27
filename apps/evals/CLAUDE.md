# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Commands

```bash
bun install          # Install dependencies
bun test             # Run all tests (69 tests across 5 files)
bun run typecheck    # TypeScript strict check (must be zero errors)
bun run build        # Build all three entry points to dist/
bun run dev:cli      # Run CLI in dev mode
bun run dev:mcp      # Run MCP server in dev mode
bun run dev:serve    # Run HTTP server in dev mode
```

## Architecture

```
src/
  types/index.ts      — All TypeScript types (EvalCase, EvalResult, AdapterConfig, etc.)
  core/
    assertions.ts     — 20+ deterministic assertion types, cheapest-first ordering
    judge.ts          — LLM-as-judge (Anthropic + OpenAI, temp=0, CoT-before-verdict)
    runner.ts         — Parallel execution, Pass^k metric, adapter dispatch
    reporter.ts       — Terminal / JSON / markdown output, run comparison
  adapters/
    http.ts           — Generic REST endpoint caller
    anthropic.ts      — Direct Anthropic API
    openai.ts         — OpenAI-compatible endpoints
    mcp.ts            — MCP server tool caller (key differentiator)
    function.ts       — JS/TS function direct call
    cli.ts            — Shell command with stdin/stdout
  datasets/
    loader.ts         — JSONL (primary) + JSON fallback, streaming, validation
  db/
    store.ts          — SQLite (WAL mode), run history, baselines
  cli/
    index.ts          — Commander.js entry point
    commands/         — One file per command
  mcp/
    index.ts          — MCP server with 8 tools (stdio transport)
  server/
    index.ts          — HTTP API server

datasets/examples/    — Example JSONL datasets (used in tests and quickstart)
```

## Key design rules

1. **PASS / FAIL / UNKNOWN only** — no numeric scores
2. **CoT before verdict** — judge reasoning always comes before the verdict
3. **temperature=0** for judges — hardcoded, not configurable
4. **Cheapest-first assertions** — deterministic → semantic → judge
5. **Judge only runs if assertions pass** — saves cost
6. **Multi-turn native** — EvalCase supports both `input` (string) and `turns` (array)
7. **Pass^k** — set `repeat: N` on any case to test consistency

## Testing

```bash
bun test                                  # All 69 tests
bun test src/core/assertions.test.ts      # Specific file
bun test --watch                          # Watch mode
```

Tests use:
- `EVALS_DB_PATH=:memory:` for SQLite isolation
- `mock.module()` for provider mocking in judge/runner tests
- Tmp files for loader tests

## Agent workflow

```bash
todos claim claude-code    # Claim next task
# ... implement ...
todos done <id> --notes "..." --commit-hash <hash>
```
