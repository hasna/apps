# Contributing

Open Changelog is a Bun and TypeScript package.

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

Use `CHANGELOG_DATA_DIR="$(mktemp -d)"` for local CLI smoke tests so development data does not mix with real app changelogs.

## Release Checks

Before publishing:

```bash
npm pack --dry-run
changelog --help
changelog-mcp --help
changelog-serve --help
```

Keep package exports, CLI commands, HTTP routes, and MCP tools aligned when adding a new capability.

