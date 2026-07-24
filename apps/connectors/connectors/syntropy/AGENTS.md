# AGENTS.md

This file provides guidance to AI coding agents when working with this repository.

## Project Overview

Syntropy API connector CLI — a TypeScript wrapper for the Syntropy agentic coding
platform (spec-driven builds, pull requests, tasks, and raw API access).

## Build & Run Commands

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build for distribution
bun run build

# Type-check
bun run typecheck

# Run tests
bun test
```

## Architecture

- `src/api/client.ts` — low-level HTTP client. Bearer auth, JSON encoding, 15s
  timeout, `base_url` override. `request()` throws `ConnectorApiError` on HTTP
  errors and returns `{ stub: true }` on network failure; `rawRequest()` surfaces
  the raw status/body without throwing.
- `src/api/specs.ts`, `builds.ts`, `pull-requests.ts`, `tasks.ts`, `raw.ts` —
  one resource module each; read paths degrade to placeholder data offline.
- `src/api/index.ts` — `Connector` class wiring the modules together, plus
  `Connector.fromEnv()` (reads `SYNTROPY_API_KEY` and optional `SYNTROPY_BASE_URL`).
- `src/cli/index.ts` — commander CLI: `profile`/`config` management plus one
  subcommand per API operation.
- `src/utils/config.ts` — profile store under `~/.hasna/connectors/connect-syntropy/`.
- `src/utils/output.ts` — `json` / `pretty` / `table` formatting.
- `src/types/index.ts` — shared types and `ConnectorApiError`.

## Conventions

- No secrets in the repo. `.env.example` holds placeholders only.
- Default base URL is `https://api.syntropy.io/v1`; override via `SYNTROPY_BASE_URL`
  or `--base-url`.
- Add tests to `src/api/syntropy.test.ts` (mock `globalThis.fetch`).
