# CLAUDE.md

This file provides guidance to Claude Code when working with the Venafi connector.

## Project Overview

connect-venafi is a TypeScript connector for the Venafi TLS Protect Cloud REST API. It provides certificate lifecycle management, event listing, search, and raw API access via CLI and library.

## Authentication

**Type:** API key (Bearer token)

Set credentials via:
- `VENAFI_API_KEY` environment variable
- `connect-venafi config set-key <key>`
- Dashboard: apikey/bearer auth (field: `apiKey`)

Optional `VENAFI_BASE_URL` overrides the default `https://api.venafi.com/v1`.

## Build & Run Commands

```bash
bun install
bun run dev
bun run typecheck
bun test
bun run build
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /certificates | List certificates |
| GET | /certificates/{id} | Get certificate |
| POST | /certificates | Create certificate |
| GET | /events | List events |
| POST | /search | Search objects |

## CLI Examples

```bash
bun run dev certificates list
bun run dev certificates get <id>
bun run dev certificates create --common-name example.com
bun run dev events list
bun run dev search --expression 'CN="example.com"'
bun run dev raw --path /certificates
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VENAFI_API_KEY` | API key (Bearer token) |
| `VENAFI_BASE_URL` | Optional API base URL |

## Data Storage

```
~/.hasna/connectors/connect-venafi/
├── current_profile
└── profiles/
    └── default.json
```
