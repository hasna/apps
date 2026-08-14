# Contributing to Conversations

Thank you for your interest in contributing. This guide covers everything you need to get started.

## Prerequisites

- [Bun](https://bun.sh) >= 1.0.0
- [Git](https://git-scm.com)

## Getting Started

```bash
# Clone the repository
git clone https://github.com/hasna/conversations.git
cd conversations

# Install dependencies
bun install

# Verify your setup
bun test
bun run typecheck
```

## Development Workflow

| Command | Description |
|---------|-------------|
| `bun run dev` | Run the CLI in development mode |
| `bun test` | Run the test suite |
| `bun run typecheck` | Type-check the project with `tsc --noEmit` |
| `bun run build` | Build CLI, MCP server, and library for production |

## Running the MCP Server Locally

To start the MCP server in development:

```bash
bun run src/mcp/index.ts
```

This launches the Model Context Protocol server that exposes messaging tools for AI agents.

## Code Style

- **Language**: TypeScript, targeting the Bun runtime
- **No external linter or formatter** is configured -- keep your code clean and consistent with the existing codebase
- Use explicit types where they improve clarity; let inference handle the obvious cases
- Prefer named exports over default exports
- Keep files focused: one concern per file when practical

## Pull Request Process

1. **Fork** the repository and create a feature branch from `main`:

   ```bash
   git checkout -b feat/your-feature
   ```

2. Make your changes and verify everything passes:

   ```bash
   bun test
   bun run typecheck
   ```

3. Write meaningful commit messages that describe what changed and why.

4. Push your branch and open a pull request against `main`.

5. In your PR description, include:
   - What the change does
   - How to test it
   - Any new dependencies or environment variables required

## Reporting Issues

Use [GitHub Issues](https://github.com/hasna/conversations/issues) to report bugs or request features. A good issue includes:

- A clear, descriptive title
- Steps to reproduce the problem
- Expected versus actual behavior
- Your environment (OS, Bun version)
- Relevant logs or error output

## Code of Conduct

This project follows a Code of Conduct to ensure a welcoming community for everyone. Please see [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) for details.

## License

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 License](./LICENSE).
