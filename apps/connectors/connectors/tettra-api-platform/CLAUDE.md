# connect-tettra-api-platform

Tettra Api Platform connector — knowledge items, events, and search API.

## API Details

- **Base URL**: `https://api.tettraapiplatform.com/v1` (override via `TETTRA_API_PLATFORM_BASE_URL`)
- **Auth**: Bearer token (`Authorization: Bearer <api_key>`)
- **Endpoints**: `GET /items`, `POST /items`, `GET /items/:itemId`, `GET /events`, `POST /search`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TETTRA_API_PLATFORM_API_KEY` | API key (Bearer token) |
| `TETTRA_API_PLATFORM_BASE_URL` | Optional base URL override |

## CLI Commands

```bash
connect-tettra-api-platform items list|get|create
connect-tettra-api-platform events list
connect-tettra-api-platform search <query>
connect-tettra-api-platform raw <method> <path> [--body <json>]
connect-tettra-api-platform profile list|use|create|delete|show
connect-tettra-api-platform config set-key|show|clear
```

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```
