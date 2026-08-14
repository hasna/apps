# AGENTS.md

This file provides guidance to AI coding agents when working with this repository.

## Project Overview

connect-stainlessapi is a TypeScript CLI and library for the public Stainless
REST API (`https://api.stainless.com`, `/v0`). It manages SDK builds, projects,
branches, organizations, and the current user, with multi-profile support.

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

## Architecture

- `src/api/client.ts` - low-level fetch wrapper; auth via the
  `x-stainless-api-key` header (NOT a Bearer token); paths are prefixed with `/v0`.
- `src/api/{builds,projects,orgs,user}.ts` - typed resource modules.
- `src/api/index.ts` - `Stainless` facade + `fromEnv()`.
- `src/cli/index.ts` - commander-based CLI entry point.
- `src/utils/config.ts` - `~/.hasna/connectors/connect-stainlessapi/` profile store.
- `src/types/index.ts` - request/response types.

## Configuration

- `STAINLESS_API_KEY` - required API key.
- `STAINLESS_PROJECT` - optional default project.
- `STAINLESS_BASE_URL` - optional base URL override.

Never commit real API keys. `.env.example` and `.npmrc.example` hold placeholders only.
