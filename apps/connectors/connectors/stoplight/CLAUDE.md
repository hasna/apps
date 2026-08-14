# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-stoplight is a TypeScript connector for Stoplight's REST API (`https://api.stoplight.io/v1`). It provides a CLI and programmatic interface for projects, events, search, and raw API access.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## CLI Commands

```bash
connect-stoplight auth login <key>
connect-stoplight auth logout
connect-stoplight auth status
connect-stoplight profile list|use|create|delete|show
connect-stoplight project list|get|create
connect-stoplight event list
connect-stoplight search run --body '<json>'
connect-stoplight raw <path> [--method POST] [--body '<json>']
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STOPLIGHT_API_KEY` | API key (overrides profile config) |
| `STOPLIGHT_BASE_URL` | API base URL (default: `https://api.stoplight.io/v1`) |

## Authentication

Uses Bearer token authentication. Auth type: apikey/bearer.

## Data Storage

```
~/.hasna/connectors/connect-stoplight/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON:

```json
{
  "apiKey": "your-key",
  "baseUrl": "https://api.stoplight.io/v1"
}
```

## Project Structure

```
src/
├── api/
│   ├── client.ts
│   └── index.ts
├── cli/
│   └── index.ts
├── types/
│   └── index.ts
├── utils/
│   ├── config.ts
│   └── output.ts
└── index.ts
```

## API Coverage

- `GET /projects` — list projects
- `POST /projects` — create project
- `GET /projects/{id}` — get project
- `GET /events` — list events
- `POST /search` — search
- Raw path escape hatch for other v1 endpoints

## Notes

Stoplight API v1 may be partially undocumented or plan-gated. Implement inventory endpoints only; document limitations in README.
