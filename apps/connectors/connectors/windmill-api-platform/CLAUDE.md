# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Windmill Api Platform connector CLI — a TypeScript wrapper for the Windmill Api Platform REST API (`https://api.windmillapiplatform.com/v1`). Provides multi-profile configuration, Bearer token authentication, and Commander.js CLI commands.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer token via API key:

```typescript
'Authorization': `Bearer ${apiKey}`,
```

Credentials via environment or profile config:

| Variable | Description |
|----------|-------------|
| `WINDMILL_API_PLATFORM_API_KEY` | API key (overrides profile) |
| `WINDMILL_API_PLATFORM_BASE_URL` | Optional base URL override |

## CLI Commands

```bash
connect-windmill-api-platform profile list
connect-windmill-api-platform config set-key <key>
connect-windmill-api-platform items list
connect-windmill-api-platform items get <itemId>
connect-windmill-api-platform items create --body '{"name":"example"}'
connect-windmill-api-platform events list
connect-windmill-api-platform search --body '{"query":"example"}'
connect-windmill-api-platform raw-request --path /items --method GET
```

## Data Storage

```
~/.hasna/connectors/connect-windmill-api-platform/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON:

```json
{
  "apiKey": "your-api-key",
  "baseUrl": "https://api.windmillapiplatform.com/v1"
}
```

## API Operations

- `GET /items` — list items
- `POST /items` — create item
- `GET /items/:id` — get item
- `GET /events` — list events
- `POST /search` — search
- `raw-request` — arbitrary path/method

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
