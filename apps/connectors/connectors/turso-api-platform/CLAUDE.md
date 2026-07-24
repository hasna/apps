# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-turso-api-platform is a TypeScript connector for the Turso Api Platform REST API. It provides a CLI and library for items, events, search, and raw API access.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer token via `Authorization: Bearer <api_key>` header.

Default base URL: `https://api.tursoapiplatform.com/v1`

Credentials stored in `~/.hasna/connectors/connect-turso-api-platform/profiles/`.

## API Endpoints

- `GET /items` — list items
- `POST /items` — create item
- `GET /items/:itemId` — get item
- `GET /events` — list events
- `POST /search` — search

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TURSO_API_PLATFORM_API_KEY` | API key |
| `TURSO_API_PLATFORM_BASE_URL` | Optional base URL override |

## CLI Commands

- `auth set-key/set-base-url/status/clear`
- `profile list/use/create/delete/show`
- `items list|create|get`
- `events list`
- `search --data <json>`
- `raw --method <method> --path <path> [--body <json>]`
