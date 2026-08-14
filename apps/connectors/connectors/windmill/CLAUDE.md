# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Windmill connector CLI — a TypeScript wrapper for the [Windmill](https://www.windmill.dev/) REST API (`https://api.windmill.dev/v1`). Provides multi-profile configuration, Bearer token authentication, and Commander.js CLI commands for scripts, events, and search.

Self-hosted Windmill instances may use workspace-scoped paths (`/api/w/{workspace}/...`). Set `WINDMILL_BASE_URL` to your instance base URL and optionally `WINDMILL_WORKSPACE` for the `X-Workspace` header. Use `raw-request` for endpoints not covered by built-in commands.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer token via API key (create in Windmill dashboard under Account Settings):

```typescript
'Authorization': `Bearer ${apiKey}`,
```

| Variable | Description |
|----------|-------------|
| `WINDMILL_API_KEY` | API key (overrides profile) |
| `WINDMILL_BASE_URL` | Optional base URL override |
| `WINDMILL_WORKSPACE` | Optional workspace ID/slug |

## CLI Commands

```bash
connect-windmill profile list
connect-windmill config set-key <key>
connect-windmill config set-base-url <url>
connect-windmill config set-workspace <workspace>
connect-windmill scripts list
connect-windmill scripts get <scriptId>
connect-windmill scripts create --body '{"path":"f/scripts/hello","summary":"Example"}'
connect-windmill events list
connect-windmill search --body '{"query":"example"}'
connect-windmill raw-request --path /scripts --method GET
```

## Data Storage

```
~/.hasna/connectors/windmill/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON:

```json
{
  "apiKey": "your-api-key",
  "baseUrl": "https://api.windmill.dev/v1",
  "workspace": "your-workspace"
}
```

## API Operations

- `GET /scripts` — list scripts
- `POST /scripts` — create script
- `GET /scripts/:id` — get script
- `GET /events` — list events
- `POST /search` — search
- `raw-request` — arbitrary path/method

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
