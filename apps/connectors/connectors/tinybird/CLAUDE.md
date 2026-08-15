# CLAUDE.md

Guidance for Claude Code when working with the Tinybird connector.

## Project Overview

`@hasna/connect-tinybird` is a TypeScript connector for the Tinybird real-time analytics API (`https://api.tinybird.co`). It provides SQL queries, pipes, datasources, event ingestion, token management, and job APIs via a Commander CLI and programmatic library.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer token authentication. Store the workspace API token in profile field `api_token` (dashboard-compatible) or `apiKey`.

Credentials can be set via:
- Environment variable `TINYBIRD_API_TOKEN`
- Profile: `tinybird config set-key <token>`
- Dashboard: save key with field `api_token`

```typescript
'Authorization': `Bearer ${apiToken}`,
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TINYBIRD_API_TOKEN` | Workspace API token (primary) |
| `TINYBIRD_HOST` | Custom API host (default `https://api.tinybird.co`) |
| `CONNECTOR_API_KEY` | Generic CLI override for API token |
| `CONNECTOR_BASE_URL` | Generic CLI override for base URL |

## CLI Commands

```bash
tinybird sql query "SELECT 1"
tinybird pipes list
tinybird pipes query <name>
tinybird datasources list
tinybird datasources create <name> --mode create --schema "..."
tinybird events ingest <name> '<ndjson>'
tinybird tokens list
tinybird jobs list
tinybird profile list
tinybird config set-key <token>
```

## Data Storage

```
~/.hasna/connectors/tinybird/
├── current_profile
└── profiles/
    └── default.json   # { "api_token": "...", "host": "..." }
```

## Dependencies

- commander
- chalk
