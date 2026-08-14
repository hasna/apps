# CLAUDE.md

Vidyard Dashboard API connector for video hosting, players, and events.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

API token auth via `auth_token` query parameter (GET) or JSON body (POST/PATCH).

- Env: `VIDYARD_API_KEY`
- Optional: `VIDYARD_BASE_URL` (default `https://api.vidyard.com/dashboard/v1`)
- Profile config: `connect-vidyard config set-key <token>`
- Dashboard serve auth type: `api_key`

## API

Base URL: `https://api.vidyard.com/dashboard/v1`

Key endpoints wrapped by this connector:

- `GET /videos`, `GET /videos/:id`, `POST /videos`
- `GET /events`, `GET /events/:id`, `GET /events/search`
- `GET /players/search`
- `rawRequest()` escape hatch

Official docs: https://developer.vidyard.com/

## Config storage

`~/.hasna/connectors/connect-vidyard/profiles/`
