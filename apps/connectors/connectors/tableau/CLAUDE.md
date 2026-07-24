# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-tableau is a TypeScript connector for the Tableau REST API. It provides CLI and
library access to explore workbooks, views, data sources, projects, and users on
Tableau Server or Tableau Cloud.

## Build & Run Commands

```bash
bun install          # install dependencies
bun run dev          # run CLI in development
bun run build        # bundle dist/ (library) + bin/ (CLI)
bun run typecheck    # tsc --noEmit

# Examples
bun run dev config show
bun run dev workbook list --page-size 100
bun run dev view get <view-id>
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Minimal dependencies: commander, chalk only
- Type annotations required everywhere

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client: sign-in flow, token caching, retry/timeout
│   └── index.ts      # Tableau API wrapper class
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   ├── config.ts     # Multi-profile configuration + credential accessors
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## Authentication

Tableau uses a session sign-in flow, not a static bearer token:

1. `POST {serverUrl}/api/{apiVersion}/auth/signin` with either a personal access token
   (`personalAccessTokenName` + `personalAccessTokenSecret`) or `name` + `password`,
   plus the site `contentUrl`.
2. The response returns a session `token` and the resolved `site.id`.
3. Subsequent requests send `X-Tableau-Auth: {token}` and are scoped under
   `/api/{apiVersion}/sites/{siteId}/...`.

`TableauClient` signs in lazily on the first request, caches the session, and
re-authenticates once on a `401`. Server errors (5xx / 429) and network timeouts are
retried with backoff.

## API Coverage

- Workbooks: list, get, query views in a workbook
- Views: list, get
- Data sources: list
- Projects: list
- Users: list

Pagination uses `pageSize` / `pageNumber` query parameters.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TABLEAU_SERVER_URL` | Tableau Server / Cloud base URL |
| `TABLEAU_SITE_NAME` | Site content URL ("" = Default site) |
| `TABLEAU_API_VERSION` | Optional REST API version |
| `TABLEAU_PAT_NAME` / `TABLEAU_PAT_SECRET` | Personal access token auth |
| `TABLEAU_USERNAME` / `TABLEAU_PASSWORD` | Username/password auth |

## Data Storage

```
~/.hasna/connectors/connect-tableau/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
