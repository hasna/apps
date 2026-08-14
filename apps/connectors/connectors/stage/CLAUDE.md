# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

connect-stage is a TypeScript connector for the Stage code-review API with multi-profile configuration support. It provides both a CLI tool and a programmatic API for working with structured code reviews, their chapters and comments, and pull requests.

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

# Run specific commands
bun run dev --help
bun run dev reviews list
bun run dev reviews get <reviewId>
bun run dev chapters list <reviewId>
bun run dev comments create <reviewId> "<body>"
bun run dev pull-requests list
bun run dev raw /reviews
```

## Authentication

Stage uses bearer-token authentication. Supply the API key one of two ways:

- Environment variable: `STAGE_API_KEY` (and optional `STAGE_BASE_URL`).
- Stored profile: `connect-stage config set-key <apiKey>` (optionally
  `connect-stage config set-base-url <url>`).

Requests are sent with an `Authorization: Bearer <apiKey>` header against
`https://api.stage.dev/v1` by default; the base URL can be overridden per
profile or via `STAGE_BASE_URL`.

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Minimal dependencies: commander, chalk only
- Type annotations required everywhere
- Use interfaces for all API types

## Project Structure

- `src/index.ts` — package entry, re-exports the `Stage` class, types and config helpers
- `src/api/` — API client and services
  - `client.ts` — `StageClient`, bearer auth + fetch wrapper
  - `reviews.ts` — reviews, chapters and comments
  - `pullRequests.ts` — pull requests
  - `index.ts` — `Stage` facade with `fromEnv()`, `raw()` and `getClient()`
- `src/cli/index.ts` — commander-based CLI entry point (`connect-stage`)
- `src/types/index.ts` — shared types (`StageConfig`, `Review`, `Chapter`, `ReviewComment`, `PullRequest`, `StageApiError`)
- `src/utils/` — `config.ts` (profile + credential storage) and `output.ts` (formatting)

## API Surface

- `GET /reviews` — list reviews
- `GET /reviews/{reviewId}` — get a review
- `GET /reviews/{reviewId}/chapters` — list chapters
- `POST /reviews/{reviewId}/comments` — create a comment
- `GET /pull-requests` — list pull requests
- `raw(path, options)` — arbitrary request for endpoints not yet wrapped
