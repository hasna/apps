# Contributing to open-evals

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

```bash
# Clone the repository
git clone https://github.com/hasna/open-evals.git
cd open-evals

# Install dependencies
bun install

# Run tests
bun test

# Type check
bun run typecheck

# Build
bun run build
```

## Project Structure

```
src/
  types/        - TypeScript types (EvalCase, EvalResult, Assertion, JudgeConfig, EvalRun)
  core/
    runner.ts   - Orchestrates eval execution (parallel, Pass^k)
    assertions/ - Deterministic assertion engine (20+ assertion types)
    judge.ts    - LLM-as-judge (multi-provider, CoT-before-verdict, temp=0)
    reporter.ts - Generate reports (JSON, markdown, terminal)
  adapters/     - App-under-test connectors (http, anthropic, openai, mcp, function, cli)
  datasets/     - JSONL loader, case generator, sampler
  db/           - SQLite for run history
  cli/          - Commander.js CLI (evals run, judge, report, ci, estimate, generate, calibrate)
  mcp/          - MCP server (evals tools for agents)
  server/       - HTTP API server
  index.ts      - Library re-exports

datasets/
  examples/     - Example JSONL eval datasets
```

## Running in Development

```bash
# CLI
bun run dev:cli

# MCP server
bun run dev:mcp

# Server
bun run dev:serve
```

## Testing

Tests use in-memory SQLite databases for full isolation:

```bash
bun test                                # Run all tests
bun test src/core/assertions.test.ts   # Run a single file
bun test --watch                        # Watch mode
```

## Making Changes

1. **Fork** the repository
2. **Create a branch** for your feature (`git checkout -b feature/my-feature`)
3. **Make your changes** and add tests
4. **Run tests** (`bun test`) and **type check** (`bun run typecheck`)
5. **Commit** with a clear message following Conventional Commits
6. **Open a Pull Request**

## Code Style

- TypeScript strict mode with `noUncheckedIndexedAccess`
- Prefer editing existing files over creating new ones
- Keep changes focused and minimal
- Add tests for new functionality
- No numeric scoring — PASS/FAIL/UNKNOWN only
- Judge always runs at temperature 0
- Chain-of-thought reasoning required before verdict

## Reporting Issues

Use [GitHub Issues](https://github.com/hasna/open-evals/issues) to report bugs or request features. Please include:

- Steps to reproduce
- Expected vs actual behavior
- Version (`evals --version`)
- Environment (OS, Bun version)
