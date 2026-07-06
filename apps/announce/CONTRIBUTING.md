# Contributing

Open Announce is a Bun and TypeScript package.

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

Use `ANNOUNCE_DATA_DIR="$(mktemp -d)"` for local CLI smoke tests so development data does not mix with real campaign data.

## Release Checks

Before publishing:

```bash
npm pack --dry-run
announce --help
announce-mcp --help
announce-serve --help
```

Keep package exports, CLI commands, HTTP routes, and MCP tools aligned when adding a new capability.

