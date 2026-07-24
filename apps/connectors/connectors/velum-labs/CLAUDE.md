# CLAUDE.md

This file provides guidance to Claude Code when working with the Velum Labs connector.

## Project Overview

Velum Labs connector CLI - TypeScript wrapper for the Velum Labs data lab platform API. Provides dataset management, event listing, search, and raw HTTP access.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## API Details

- **Base URL**: `https://api.velum-labs.com/v1`
- **Auth**: Bearer token (`Authorization: Bearer <api_key>`)

### Endpoints

- `GET /datasets` - List datasets
- `POST /datasets` - Create dataset
- `GET /datasets/:id` - Get dataset
- `GET /events` - List events
- `POST /search` - Search across data

## Authentication

API key authentication via Bearer token. Credentials can be set via:

- Environment variable `VELUM_LABS_API_KEY`
- Profile configuration: `connect-velum-labs config set-key <key>`
- Optional base URL override: `VELUM_LABS_BASE_URL` or `config set-base-url`

## CLI Commands

```bash
connect-velum-labs datasets list [--limit <n>] [--offset <n>]
connect-velum-labs datasets get <datasetId>
connect-velum-labs datasets create --name <name> [--description <text>]
connect-velum-labs events [--limit <n>] [--type <type>]
connect-velum-labs search <query> [--dataset-id <id>]
connect-velum-labs raw-request --path <path> [-X <method>] [--query <json>] [--body <json>]
connect-velum-labs config set-key <key>
connect-velum-labs config show
connect-velum-labs profile list|use|create|delete|show
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VELUM_LABS_API_KEY` | API key (overrides profile) |
| `VELUM_LABS_BASE_URL` | Override API base URL |

## Data Storage

```
~/.hasna/connectors/connect-velum-labs/
├── current_profile
└── profiles/
    ├── default.json
    └── {name}.json
```

Profile JSON structure:

```json
{
  "apiKey": "your-api-key",
  "baseUrl": "https://api.velum-labs.com/v1"
}
```
