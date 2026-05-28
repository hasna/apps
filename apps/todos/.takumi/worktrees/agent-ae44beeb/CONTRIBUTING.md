# Contributing to todos.md

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

```bash
# Clone the repository
git clone https://github.com/hasna/open-todos.git
cd open-todos

# Install dependencies
bun install

# Run tests
bun test

# Type check
bun run typecheck

# Build
bun run build

# Build dashboard
cd dashboard && bun install && bun run build
```

## Project Structure

```
src/
  types/     - TypeScript types, enums, error classes
  db/        - SQLite data layer (database, tasks, projects, plans, etc.)
  lib/       - Business logic (search, sync, config, rate limiting)
  cli/       - Commander.js CLI + React/Ink TUI
  mcp/       - MCP server with stdio transport
  server/    - HTTP server with REST API
  index.ts   - Library re-exports

dashboard/
  src/       - React + shadcn/ui web dashboard
```

## Running in Development

```bash
# CLI
bun run dev:cli

# MCP server
bun run dev:mcp

# Dashboard (with hot reload)
cd dashboard && bun run dev

# Server
bun run src/cli/index.tsx serve --port 19420 --no-open
```

## Testing

Tests use in-memory SQLite databases for full isolation:

```bash
bun test                       # Run all tests
bun test src/db/tasks.test.ts  # Run a single file
```

## Making Changes

1. **Fork** the repository
2. **Create a branch** for your feature (`git checkout -b feature/my-feature`)
3. **Make your changes** and add tests
4. **Run tests** (`bun test`) and **type check** (`bun run typecheck`)
5. **Commit** with a clear message
6. **Open a Pull Request**

## Code Style

- TypeScript strict mode with `noUncheckedIndexedAccess`
- Prefer editing existing files over creating new ones
- Keep changes focused and minimal
- Add tests for new functionality

## Reporting Issues

Use [GitHub Issues](https://github.com/hasna/open-todos/issues) to report bugs or request features. Please include:

- Steps to reproduce
- Expected vs actual behavior
- Version (`todos --version`)
- Environment (OS, Bun version)
