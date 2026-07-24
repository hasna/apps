# CLAUDE.md — Zoho Analytics Connector

## Overview

`@hasna/connect-zoho-analytics` wraps the Zoho Analytics v2 REST API (`/restapi/v2/*`).

## Auth

- **Type:** OAuth2 (`Zoho-oauthtoken` header)
- **Required:** `access_token` + `org_id` (sent as `ZANALYTICS-ORGID` header)
- **Optional:** `data_center` — routes to `analyticsapi.zoho.{com|eu|in|...}`

Environment variables: `ZOHO_ANALYTICS_TOKEN`, `ZOHO_ANALYTICS_ORG_ID`, `ZOHO_ANALYTICS_DATA_CENTER`.

Profiles stored at `~/.hasna/connectors/zoho-analytics/profiles/`.

## API Pattern

Mutating and filter calls pass a `CONFIG` JSON query parameter (not request body for most endpoints).

## Commands

```bash
bun install
bun run typecheck
bun test src/api/client.test.ts
bun run dev list-workspaces
```

## Key Files

- `src/api/client.ts` — HTTP client with DC routing and CONFIG param handling
- `src/api/index.ts` — `ZohoAnalytics` facade (27 methods)
- `src/cli/index.ts` — Commander CLI
