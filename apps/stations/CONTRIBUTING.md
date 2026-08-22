# Contributing to @hasna/stations

Thanks for your interest in contributing.

## Development Setup

```bash
git clone https://github.com/hasna/stations.git
cd stations
bun install

bun test
bun run typecheck
bun run build
bun run src/cli/index.ts --help
```

## Project Structure

```text
src/
  agent/       - `stations-daemon` heartbeat daemon entrypoint
  cli/         - Commander CLI for the `stations` binary
  commands/    - CLI command implementations
  mcp/         - MCP server and Streamable HTTP transport
  *.ts         - SDK, topology, storage, manifests, redaction, and release logic
schemas/       - Published consumer JSON schemas
scripts/       - Release and consumer-conformance checks
test/          - Bun test suite
```

## Running in Development

```bash
bun run dev -- --help
bun run dev:mcp -- --help
bun run dev:agent -- --help
```

Use temporary data paths when testing storage or daemon behavior manually:

```bash
export HASNA_STATIONS_DIR="$(mktemp -d)"
export HASNA_STATIONS_DB_PATH="$HASNA_STATIONS_DIR/stations.db"
export HASNA_STATIONS_MANIFEST_PATH="$HASNA_STATIONS_DIR/stations.json"
```

## Testing

```bash
bun test
bun run typecheck
bun run build
bun run smoke:consumer-conformance
bun run verify:release
```

`verify:release` checks the publishable package surface, package contents, CLI
binary boundaries, installed package smoke tests, and consumer conformance.

## Making Changes

1. Fork and branch (`git checkout -b feature/my-feature`).
2. Keep changes focused and add tests for new behavior.
3. Preserve public-safe defaults for CLI, MCP, HTTP, and SDK output.
4. Do not add private fleet data, secrets, local databases, or environment
   files to the repo or npm package.
5. Run the relevant Bun validation commands before opening a pull request.
6. Commit with a clear conventional commit message.

## Reporting Issues

Use [GitHub Issues](https://github.com/hasna/stations/issues). Include repro
steps, expected vs. actual behavior, the package version (`stations --version`),
your OS, Bun version, and sanitized command output. Do not include private
manifests, route targets, database URLs, API keys, or private metadata.
