# AGENTS.md

This file provides guidance to AI coding agents when working with this repository.

## Project Overview

connect-tensorboard is a TypeScript connector for TensorBoard's public HTTP data
API. It reads training runs, scalar tags, and scalar time series from a running
TensorBoard server. It provides both a CLI and a programmatic API. No
authentication is required — only the server's base URL.

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
├── cli/index.ts   # CLI commands
├── types/index.ts # TypeScript types
├── utils/         # config + output helpers
└── index.ts       # Library exports
```

## API Notes

- Base URL: `http://localhost:6006` (configurable / `TENSORBOARD_BASE_URL`)
- `GET /data/runs`, `/data/plugin/scalars/tags`, `/data/plugin/scalars/scalars`, `/data/environment`
- Read-only, unauthenticated.

## Testing

`bun test` runs `src/api/client.test.ts`, which stubs `globalThis.fetch` to
assert URL/query building, response normalization, and error handling.
