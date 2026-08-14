# CLAUDE.md

Guidance for working with the Zoho Sign connector.

## Overview

`@hasna/connect-zoho-sign` wraps the Zoho Sign REST API (`/api/v1`) with OAuth (`Zoho-oauthtoken`) authentication and multi data-center base URL routing.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

- OAuth access token via `ZOHO_SIGN_TOKEN` or profile `token`
- Header: `Authorization: Zoho-oauthtoken <token>`
- Data centers map to `sign.zoho.com`, `sign.zoho.eu`, `sign.zoho.in`, etc.

## API Root

Default: `https://sign.zoho.com/api/v1` (US). Override with `ZOHO_SIGN_DATA_CENTER` or `ZOHO_SIGN_BASE_URL`.

## Structure

```
src/
├── api/client.ts   # HTTP transport, DC routing, status:failure handling
├── api/index.ts    # ZohoSign high-level methods
├── cli/index.ts    # Commander CLI (`zoho-sign`)
├── types/index.ts
└── utils/config.ts # Profiles under ~/.hasna/connectors/connect-zoho-sign/
```

## Response Handling

Zoho Sign returns JSON with `status: success|failure`. The client throws `ZohoSignApiError` on HTTP errors or `status: failure`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZOHO_SIGN_TOKEN` | OAuth access token |
| `ZOHO_SIGN_DATA_CENTER` | `com`, `eu`, `in`, `com.au`, `jp`, `ca` |
| `ZOHO_SIGN_BASE_URL` | Optional full API base URL |
