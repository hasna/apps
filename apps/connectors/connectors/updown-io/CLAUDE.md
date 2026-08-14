# CLAUDE.md

Guidance for working with `@hasna/connect-updown-io`.

## Overview

Connector for the updown.io website monitoring REST API. Authentication uses an API key in the `X-API-KEY` header (or `?api-key=` query param — this client uses the header).

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts
```

## API

Base URL: `https://updown.io/api`

Read-only GET endpoints implemented:

- `GET /checks` — list checks
- `GET /checks/:token` — single check
- `GET /checks/:token/downtimes` — downtime history
- `GET /checks/:token/metrics` — performance metrics
- `GET /nodes` — monitoring nodes
- `GET /nodes/ips` — node IP addresses

## Auth

- Type: `api_key`
- Env: `UPDOWN_IO_API_KEY`
- Help URL: https://updown.io/api
- Profiles: `~/.hasna/connectors/connect-updown-io/profiles/`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `UPDOWN_IO_API_KEY` | API key from updown.io account settings |

## Notes

- Path tokens are passed through `encodeURIComponent` (tokens may contain slashes).
- Optional query parameters are omitted when empty.
- HTTP 204 responses are normalized to `{}`.
