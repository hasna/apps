# connect-workato-api-platform

Workato API Platform connector — customer runtime REST API for items, events, and search.

## API Details

- **Base URL**: tenant-specific runtime API URL configured with `WORKATO_API_PLATFORM_BASE_URL`
- **Auth**: API key via Bearer token (`Authorization: Bearer <api_key>`)
- **Not** the Workato workspace management API (`workato.com/api/*`)

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/items` | List items |
| POST | `/items` | Create item |
| GET | `/items/:id` | Get item by ID |
| GET | `/events` | List events |
| POST | `/search` | Search runtime data |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WORKATO_API_PLATFORM_API_KEY` | Runtime API key |
| `WORKATO_API_PLATFORM_BASE_URL` | Required tenant-specific runtime API base URL |

## CLI Commands

```bash
connect-workato-api-platform items list|get|create
connect-workato-api-platform events list
connect-workato-api-platform search run --body <json>
connect-workato-api-platform request send -p <path>
connect-workato-api-platform config set-key|set-base-url|show|clear
connect-workato-api-platform profile list|use|create|delete|show
```

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts
```
