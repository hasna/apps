# CLAUDE.md — Zoho Forms Connector

## Overview

`@hasna/connect-zohoforms` is a TypeScript API connector for Zoho Forms v2 REST API.

## Commands

```bash
bun install
bun run dev          # CLI from source
bun run typecheck
bun test src/api/client.test.ts
bun run build
```

## Authentication

- OAuth 2.0 access token via `Zoho-oauthtoken` header
- User supplies token from Zoho OAuth (not Google dashboard OAuth)
- Env: `ZOHOFORMS_TOKEN`, `ZOHOFORMS_DATA_CENTER` (default `com`)

## API Base URLs

| Data center | Base URL |
|-------------|----------|
| com (default) | `https://forms.zoho.com/api/v2` |
| eu | `https://forms.zoho.eu/api/v2` |
| in | `https://forms.zoho.in/api/v2` |
| com.au | `https://forms.zoho.com.au/api/v2` |
| jp | `https://forms.zoho.jp/api/v2` |
| ca | `https://forms.zoho.ca/api/v2` |
| sa | `https://forms.zoho.sa/api/v2` |

## Key Files

- `src/api/client.ts` — HTTP transport, DC resolution, auth
- `src/api/index.ts` — `ZohoForms` facade (forms, entries, webhooks, tasks, etc.)
- `src/cli/index.ts` — `connect-zohoforms` CLI
- `src/utils/config.ts` — profiles at `~/.hasna/connectors/connect-zohoforms/`

## Docs

https://www.zoho.com/forms/help/api/
