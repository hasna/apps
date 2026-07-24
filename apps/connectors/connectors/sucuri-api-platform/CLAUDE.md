# CLAUDE.md

This file provides guidance to Claude Code when working with the Sucuri API Platform connector.

## Project Overview

`connect-sucuri-api-platform` is a TypeScript connector for the Sucuri API Platform REST API. It provides a CLI and library for listing items, events, search, and arbitrary API requests.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test

# Examples
bun run dev config show
bun run dev items list
bun run dev items get <itemId>
bun run dev items create --data '{"name":"example"}'
bun run dev events list
bun run dev search query --query "example"
bun run dev raw request --path /items --method GET
```

## API Details

- **Base URL**: `https://api.sucuriapiplatform.com/v1` (override via `SUCURI_API_PLATFORM_BASE_URL` or profile `baseUrl`)
- **Auth**: Bearer token (`Authorization: Bearer <api_key>`)
- **Endpoints**:
  - `GET /items` — list items
  - `POST /items` — create item
  - `GET /items/:itemId` — get item
  - `GET /events` — list events
  - `POST /search` — search resources

Public documentation for `api.sucuriapiplatform.com` is limited; types are intentionally permissive (`unknown` / `Record<string, unknown>`). Use `raw request` for undocumented endpoints.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUCURI_API_PLATFORM_API_KEY` | API key (overrides profile) |
| `SUCURI_API_PLATFORM_BASE_URL` | Optional custom base URL |

## Data Storage

```
~/.hasna/connectors/connect-sucuri-api-platform/
├── current_profile
├── settings.json
└── profiles/
    └── default.json
```

## Distinction from `connect-sucuri`

The sibling `sucuri` connector targets `api.sucuri.net/v1` (site/WAF management). This connector targets `api.sucuriapiplatform.com/v1` (API Platform resources).
