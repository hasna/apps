# CLAUDE.md

Guidance for working on the Wait connector (`@hasna/connect-wait`).

## Overview

REST API client for the Wait delay workflow platform at `https://api.wait.com/v1`.
Authentication uses Bearer token (`WAIT_API_KEY`).

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test
bun run build
```

## API Methods

| Method | HTTP | Path |
|--------|------|------|
| `listDelays` | GET | `/delays` |
| `createDelay` | POST | `/delays` |
| `getDelay` | GET | `/delays/:id` |
| `listEvents` | GET | `/events` |
| `search` | POST | `/search` |
| `rawRequest` | * | arbitrary path |

## Configuration

Profiles stored in `~/.hasna/connectors/connect-wait/profiles/`.

Environment variables override profile config:
- `WAIT_API_KEY`
- `WAIT_BASE_URL`

## Notes

- Distinct from Waitwhile (`developers.waitwhile.com`) — this connector targets `api.wait.com`.
- Types are intentionally loose; no public OpenAPI spec was available at implementation time.
