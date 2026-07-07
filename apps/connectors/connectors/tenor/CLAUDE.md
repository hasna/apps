# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@hasna/connect-tenor` is a TypeScript connector CLI for Google's Tenor v2 API
(https://developers.google.com/tenor). It exposes the public, read-only GIF
discovery endpoints: search, featured, categories, autocomplete, and trending
terms.

## Build & Run Commands

```bash
bun install          # Install dependencies
bun run dev          # Run the CLI in development
bun run build        # Build dist/ and bin/
bun run typecheck    # Type check with tsc --noEmit
bun test             # Run tests

# Examples
bun run dev search "cats" --limit 5
bun run dev categories --type trending
```

## Authentication

Tenor authenticates with an **API key passed as the `key` query parameter** — not
an `Authorization` header. The key is injected into every request URL by
`ConnectorClient.buildUrl()` in `src/api/client.ts`. An optional `client_key`
query parameter identifies the integration.

Key resolution order (see `src/utils/config.ts`):
1. `TENOR_API_KEY` environment variable
2. Active profile's stored `apiKey`
3. `-k/--api-key` CLI flag (sets `TENOR_API_KEY` for the process)

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client — query-param auth, retry, timeout
│   ├── tenor.ts      # TenorApi module (search/featured/categories/…)
│   └── index.ts      # Connector class + fromEnv()
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Tenor response/param types + error helpers
├── utils/            # Shared scaffold utilities (config, output, storage, …)
└── index.ts          # Library exports
```

## Key Endpoints (Tenor v2)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `search(q, params)` | `GET /search` | Search GIFs/stickers |
| `featured(params)` | `GET /featured` | Featured GIF feed |
| `categories(params)` | `GET /categories` | Category listing |
| `autocomplete(q, params)` | `GET /autocomplete` | Search suggestions |
| `trendingTerms(params)` | `GET /trending_terms` | Trending search terms |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TENOR_API_KEY` | Tenor API key (required) |
| `TENOR_CLIENT_KEY` | Optional client key |
| `TENOR_BASE_URL` | Override base URL (default `https://tenor.googleapis.com/v2`) |

## Notes

- All endpoints are read-only; there are no write operations.
- Tests mock `fetch` and assert URL/param construction; they do not make live API
  calls and require no real key.
