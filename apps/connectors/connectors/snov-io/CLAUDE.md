# CLAUDE.md

This file provides guidance to Claude Code when working with the Snov.io connector.

## Project Overview

`@hasna/connect-snov-io` is a TypeScript connector for the Snov.io email outreach and prospecting API.

## Build & Run Commands

```bash
bun install
bun run dev config show
bun run typecheck
bun run build
```

## Authentication

**OAuth2 client_credentials** — NOT a static Bearer API key.

1. User obtains API User ID + API Secret from Snov.io Account → API settings
2. Connector POSTs to `https://api.snov.io/v1/oauth/access_token` with:
   - `grant_type=client_credentials`
   - `client_id` (API User ID)
   - `client_secret` (API Secret)
3. Access token is cached with 60s expiry buffer

Profile fields: `clientId`, `clientSecret`
Environment variables: `SNOV_IO_CLIENT_ID`, `SNOV_IO_CLIENT_SECRET`

### Per-endpoint auth styles

- **v1 endpoints** (e.g. `/v1/get-user-campaigns`, `/v1/get-balance`): pass `access_token` as query parameter
- **v2 endpoints** (e.g. `/v2/domain-search/*`): `Authorization: Bearer <token>` header

## API Modules

| Module | File | Endpoints |
|--------|------|-----------|
| campaigns | `src/api/campaigns.ts` | GET `/v1/get-user-campaigns` |
| domain-search | `src/api/domain-search.ts` | POST `/v2/domain-search/start`, GET `/v2/domain-search/result/{task_hash}` |
| account | `src/api/account.ts` | GET `/v1/get-balance` |

## Config Storage

```
~/.hasna/connectors/snov-io/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON:
```json
{
  "clientId": "api-user-id",
  "clientSecret": "api-secret"
}
```

## Rate Limits

60 requests per minute per Snov.io account.

## Dashboard Auth Detection

Auth type: **apikey** (client_id + client_secret fields). CLAUDE.md documents client credentials flow.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SNOV_IO_CLIENT_ID` | API User ID |
| `SNOV_IO_CLIENT_SECRET` | API Secret |
| `SNOV_IO_BASE_URL` | Override base URL (default: https://api.snov.io) |
