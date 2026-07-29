# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Commands

```bash
bun install          # Install root dependencies (CLI, MCP, HTTP server)
bun test             # Run all tests
bun run typecheck    # TypeScript strict check (must be zero errors)
bun run build        # Build dashboard and four package entry points
bun run dev:cli      # Run CLI in dev mode
bun run dev:mcp      # Run MCP server in dev mode
bun run dev:serve    # Run HTTP server in dev mode
```

`dashboard/` is a second install root, not a workspace of the repository root, so
the root `bun install` does not reach it. `bun run build` shells into
`cd dashboard && bun run build` and fails with `Cannot find module 'vite'` until
the dashboard is installed separately, once:

```bash
cd dashboard && bun install
```

## Architecture

```
src/
  types/index.ts      — All TypeScript types (EvalCase, EvalResult, AdapterConfig, etc.)
  core/
    assertions.ts     — 19 assertion types, cheapest-first ordering
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
    index.ts          — MCP server with 8 tools (HTTP default, stdio opt-in)
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
bun test                                  # All tests
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
