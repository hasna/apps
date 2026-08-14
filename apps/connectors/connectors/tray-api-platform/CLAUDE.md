# connect-tray-api-platform

Tray API Platform connector — customer runtime REST API for items, events, and search.

## API Details

- **Base URL**: `https://api.trayapiplatform.com/v1` (tenant-specific override supported)
- **Auth**: API key via Bearer token (`Authorization: Bearer <api_key>`)
- **Not** the tray.io iPaaS or Tray Platform workspace management API

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
| `TRAY_API_PLATFORM_API_KEY` | Runtime API key |
| `TRAY_API_PLATFORM_BASE_URL` | Optional base URL override |

## CLI Commands

```bash
connect-tray-api-platform items list|get|create
connect-tray-api-platform events list
connect-tray-api-platform search run --body <json>
connect-tray-api-platform request send -p <path>
connect-tray-api-platform config set-key|set-base-url|show|clear
connect-tray-api-platform profile list|use|create|delete|show
```

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts
```
