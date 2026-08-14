# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-thoughtspot is a TypeScript connector for the ThoughtSpot REST API v2. It provides a CLI and library for liveboards, metadata search, analytics queries, and audit logs.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts

bun run dev liveboards list
bun run dev liveboards get <liveboardId>
bun run dev events list
bun run dev search data --body '{"query_string":"revenue by region"}'
bun run dev raw -m POST -P /metadata/search --body '{"metadata":[{"type":"LIVEBOARD"}]}'
```

## Authentication

**Bearer Token** — obtain a token from your ThoughtSpot instance (`POST /api/rest/2.0/auth/token/full`) and configure it as `THOUGHTSPOT_API_KEY` or via `config set-key`.

## API Details

- **Base URL**: Per-instance, must include `/api/rest/2.0` (e.g. `https://your-instance.thoughtspot.cloud/api/rest/2.0`)
- **Auth**: `Authorization: Bearer <token>`
- **Docs**: https://developers.thoughtspot.com/docs/rest-api-v2

### Command mapping (v2)

| Command | Endpoint |
|---------|----------|
| listLiveboards | `POST /metadata/search` |
| createLiveboard | `POST /metadata/tml/import` |
| getLiveboard | `POST /metadata/search` |
| listEvents | `POST /logs/fetch` |
| search | `POST /searchdata` or `POST /metadata/search` |
| rawRequest | arbitrary path under base URL |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `THOUGHTSPOT_API_KEY` | Bearer token |
| `THOUGHTSPOT_BASE_URL` | Instance REST API v2 base URL |

## Data Storage

```
~/.hasna/connectors/connect-thoughtspot/
├── current_profile
└── profiles/
    └── default.json
```

## Dependencies

- commander
- chalk
