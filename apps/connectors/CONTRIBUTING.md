# Contributing

Thanks for helping improve the connectors. Please follow these guidelines so we can keep publishing safe and consistent.

## Development Setup

```bash
# Clone and install
git clone https://github.com/hasna/connectors.git
cd connectors
bun install              # Installs all deps (dashboard deps via postinstall)

# Build everything (dashboard + CLI + MCP + serve)
bun run build

# Run CLI in development
bun run dev

# Type check
bun run typecheck
```

## Running Tests

```bash
bun test                 # Run the full test suite
```

## Adding a New Connector

1. Verify the connector is **not** in the blacklist (see CLAUDE.md).
2. Create `connectors/connect-{name}/` with the standard structure:
   ```
   connect-{name}/
   ├── src/
   │   ├── api/           # API client modules
   │   ├── cli/           # CLI commands
   │   ├── types/         # TypeScript types
   │   └── utils/         # Configuration utilities
   ├── CLAUDE.md          # Development guide
   ├── README.md          # Usage documentation
   └── package.json
   ```
3. Use `@hasna` as the npm scope in `package.json` and `.npmrc`.
4. Remove any internal references (private org names, internal URLs).
5. Register the connector in `src/lib/registry.ts`.
6. Ensure no secrets or API keys are committed.

## Commit Message Conventions

Follow the existing commit style with a type prefix:

- `feat:` — New feature or connector
- `fix:` — Bug fix
- `chore:` — Maintenance, deps, config changes
- `test:` — Adding or updating tests
- `docs:` — Documentation only

Examples:
```
feat: add connect-notion connector
fix: correct OAuth callback URL for Google connectors
chore: bump all connector versions to 0.2.0
test: add component tests for installer
```

## Pull Request Process

1. Fork the repository and create a branch from `main`.
2. Make your changes, following existing patterns and code style.
3. Run `bun test` and `bun run typecheck` to verify nothing is broken.
4. Write a clear PR description explaining **what** and **why**.
5. Keep PRs focused — one connector or one fix per PR when possible.

## NPM Auth (Optional)

If you need a scoped registry token (publish or private installs), copy an example file and set `NPM_TOKEN`:

```bash
# Repo root
cp .npmrc.example .npmrc

# Or per-connector
cp connectors/connect-<name>/.npmrc.example connectors/connect-<name>/.npmrc
```

- Do not commit `.npmrc` files with real tokens.
- Use environment variables in CI: `NPM_TOKEN` only.

## Safe Publish Flow

- Run the connector release script from that connector folder:
  - `bun run release` (or `release:patch`, `release:minor`, `release:major`)
- CI should inject `NPM_TOKEN` and create `.npmrc` at runtime if needed.

## Secrets

- Never commit `.env` files with real values.
- Keep credentials in your local environment only.
