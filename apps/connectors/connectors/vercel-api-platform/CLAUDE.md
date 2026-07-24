# CLAUDE.md

Guidance for working with the Vercel Api Platform connector.

## Distinction from connect-vercel

This connector targets **Vercel Api Platform** at `https://api.vercelapiplatform.com/v1` (items, events, search). It is **not** the same as `connect-vercel`, which wraps `api.vercel.com` for deployments and projects.

## API Reference

- **Base URL**: `https://api.vercelapiplatform.com/v1` (override via profile or `VERCEL_API_PLATFORM_BASE_URL`)
- **Auth**: Bearer token (`Authorization: Bearer <api_key>`)
- **Endpoints**:
  - `GET /items` — list items
  - `POST /items` — create item
  - `GET /items/{itemId}` — get item (path segments URL-encoded)
  - `GET /events` — list events
  - `POST /search` — search resources
  - Raw requests via `raw-request` CLI command

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VERCEL_API_PLATFORM_API_KEY` | API key (required) |
| `VERCEL_API_PLATFORM_BASE_URL` | Optional API base URL override |

## CLI Commands

```bash
connect-vercel-api-platform items list
connect-vercel-api-platform items create -d '{"name":"example"}'
connect-vercel-api-platform items get <itemId>
connect-vercel-api-platform events list
connect-vercel-api-platform search -d '{"query":"example"}'
connect-vercel-api-platform raw-request --path /items [-m GET] [-d '{}'] [-q '{}']
connect-vercel-api-platform profile list|use|create|delete|show
connect-vercel-api-platform config set-key|set-base-url|show|clear
```

## Build & Run

```bash
bun install
bun run dev
bun run typecheck
bun test src/api/client.test.ts
```
