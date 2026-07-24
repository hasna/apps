# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

`connect-synphony` is a TypeScript connector for the Synphony farm-robotics platform. It provides access to farms, robots, telemetry, harvest runs, and bed analytics.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun test              # Run tests
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Type annotations required everywhere

## Architecture

### Authentication

Synphony uses a Bearer token in the `Authorization` header:

```
Authorization: Bearer <SYNPHONY_API_KEY>
```

The API base URL defaults to `https://api.synphony.ai/v1` and can be overridden
via `SYNPHONY_BASE_URL`, the `--base-url` flag, or a stored profile.

### Layout

- `src/api/client.ts` — HTTP client (Bearer auth, retries/backoff, base-URL override)
- `src/api/synphony.ts` — the typed operations (farms, robots, telemetry, harvest runs, bed analytics, raw)
- `src/api/index.ts` — `Connector` facade + `fromEnv()`
- `src/cli/index.ts` — Commander CLI
- `src/types/index.ts` — config, domain, and error types
- `src/utils/` — config (profiles), output formatting, settings

### Adding operations

The Synphony API is not fully publicly documented. When wrapping new endpoints,
prefer keeping response types open (index signatures) so unknown fields are not
dropped, and rely on `rawRequest` for anything not yet typed.
