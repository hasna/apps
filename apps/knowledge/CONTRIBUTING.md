# Contributing to open-knowledge

Thank you for your interest in contributing!

## Development Setup

```bash
# Clone the repo
git clone https://github.com/hasna/knowledge.git
cd knowledge

# Install dependencies (Bun)
bun install

# Run tests
bun test

# Run a specific test file
bun test tests/cli.test.ts
```

## Project Structure

```
knowledge/
├── src/
│   ├── cli.js    # CLI entry point, argument parsing, commands
│   └── store.js  # Persistent store, file locking, ID generation
├── tests/
│   └── cli.test.ts  # Integration tests using Bun.test
├── package.json
└── LICENSE
```

## Design Principles

**Agent-friendly first**: every output should be parseable by an LLM. Prefer `--json` for structured data. Keep error messages actionable.

**Minimal dependencies**: keep the dependency footprint small. The store is a plain JSON file.

**Safe by default**: destructive operations require explicit confirmation flags (`--yes`).

**Concurrent-safe**: all store mutations go through `withLock()`. Do not bypass it.

## Commit Conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(cli): add --tag filter on list command
fix(store): handle empty store file gracefully
docs(readme): add installation instructions
```

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`

## Pull Request Process

1. Fork the repo and create a branch from `main`.
2. Add tests for new functionality.
3. Ensure all tests pass: `bun test`.
4. Keep commits atomic and well-described.
5. Open a PR with a clear description of the change and motivation.

## Code Style

- 2-space indentation
- `for` loops over array methods where performance matters
- Descriptive variable names
- No unnecessary dependencies

## Reporting Issues

- Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml)
- Search existing issues first
- Include: Node/Bun version, OS, steps to reproduce, expected vs actual

## Suggesting Features

Open a [feature request issue](.github/ISSUE_TEMPLATE/feature_request.yml) describing:
- The problem you're solving
- How you envision the solution
- Whether you're willing to implement it
