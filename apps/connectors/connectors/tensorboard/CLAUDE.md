# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

TensorBoard connector CLI — read training runs, scalar tags, and scalar metrics
from a running TensorBoard server via its public, unauthenticated HTTP data API.

## Build & Run Commands

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build for distribution
bun run build

# Type check
bun run typecheck

# Run tests
bun test
```

## Code Style

- TypeScript with strict mode
- ESM modules (`type: module`)
- Async/await for all async operations
- Minimal dependencies: commander, chalk
- Type annotations required everywhere

## Project Structure

```
src/
├── api/           # API client modules
│   ├── client.ts  # Low-level HTTP transport (no auth)
│   ├── runs.ts    # Run listing
│   ├── scalars.ts # Scalar tags + series
│   └── index.ts   # TensorBoard facade class
├── cli/
│   └── index.ts   # CLI commands
├── types/
│   └── index.ts   # TypeScript types
├── utils/
│   ├── config.ts  # Base URL configuration
│   └── output.ts  # CLI output formatting
└── index.ts       # Library exports
```

## API Notes

TensorBoard's data API is free and read-only — no API key or authentication.
- Base URL: `http://localhost:6006` (configurable / `TENSORBOARD_BASE_URL`)
- `GET /data/runs` — run names
- `GET /data/plugin/scalars/tags` — scalar tags grouped by run
- `GET /data/plugin/scalars/scalars?run=<run>&tag=<tag>` — scalar series
- `GET /data/environment` — server/experiment metadata

## Authentication

None. The connector only needs the base URL of a running TensorBoard server.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TENSORBOARD_BASE_URL` | Base URL of the TensorBoard server (default `http://localhost:6006`) |

## Data Storage

```
~/.hasna/connectors/connect-tensorboard/
└── config.json    # User preferences (base URL)
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
