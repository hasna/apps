# CLAUDE.md

Guidance for Claude Code when working with the Transform connector.

## Project Overview

connect-transform is a TypeScript connector for the Transform data transform platform API (`https://api.transform.com/v1`). It provides multi-profile configuration, Bearer token authentication, and CLI commands for pipelines, events, search, and raw requests.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts
```

## Authentication

Bearer token authentication with `api_key`. Credentials via:

- `TRANSFORM_API_KEY` environment variable
- Profile config: `connect-transform config set-key <key>`

Transform uses `Authorization: Bearer <api_key>` — not Telestream Transform (`X-Api-Key`).

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TRANSFORM_API_KEY` | API key (overrides profile) |
| `TRANSFORM_BASE_URL` | Override base URL (default `https://api.transform.com/v1`) |

## API Modules

- `pipelines` — `GET/POST /pipelines`, `GET /pipelines/:id`
- `events` — `GET /events`
- `search` — `POST /search`
- `raw` — arbitrary method/path/query/body

## Data Storage

```
~/.hasna/connectors/transform/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON:

```json
{
  "apiKey": "your-api-key",
  "baseUrl": "https://api.transform.com/v1"
}
```
