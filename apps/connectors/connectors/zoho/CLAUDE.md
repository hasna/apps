# CLAUDE.md

Zoho CRM v8 connector (`connect-zoho`).

## Overview

TypeScript connector for the Zoho CRM REST API v8. Authenticates with OAuth access tokens (`Zoho-oauthtoken` header).

## Commands

```bash
bun install
bun run dev          # CLI
bun run typecheck
bun test
bun run build
```

## Environment

| Variable | Description |
|----------|-------------|
| `ZOHO_ACCESS_TOKEN` | OAuth access token |
| `ZOHO_BASE_URL` | Optional API base (default: `https://www.zohoapis.com/crm/v8`) |

## API Methods

- `listContacts`, `getContact`, `addContacts`
- `listLeads`, `listAccounts`, `listDeals`
- `rawRequest` for arbitrary v8 paths

## Config Storage

Profiles at `~/.hasna/connectors/connect-zoho/profiles/`.

## Related Connectors

This slug (`zoho`) is distinct from `zohocrm` (v5), `zohobooks`, `zohodesk`, and `zohoworkdrive`.
