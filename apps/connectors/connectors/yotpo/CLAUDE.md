# CLAUDE.md

This file provides guidance to Claude Code when working with the Yotpo connector.

## Project Overview

`@hasna/connect-yotpo` is a TypeScript connector for the Yotpo Reviews and UGC API.

## Authentication

Yotpo uses store ID (app key) + API secret exchanged for a utoken:

- `POST /oauth/token` with `{ client_id, client_secret, grant_type: "client_credentials" }`
- utokens are cached until expiry (~14 days); refresh on 401
- Authenticated calls pass `utoken` as a query parameter

Dashboard auth type: **apikey** (store ID + API secret).

## Build & Run

```bash
bun install
bun run dev
bun run typecheck
bun run build
bun test
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `YOTPO_STORE_ID` | Store ID / app key |
| `YOTPO_API_SECRET` | API secret |
| `YOTPO_BASE_URL` | Optional base URL |

## Key Endpoints

- List reviews: `GET /v1/apps/{store_id}/reviews?utoken=...`
- Get review: `GET /v1/apps/{store_id}/reviews/{id}?utoken=...`
- Create review: `POST /reviews/dynamic_create` (body includes appkey + utoken)

## Profile Storage

`~/.hasna/connectors/connect-yotpo/profiles/`
