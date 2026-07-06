# CLAUDE.md

Guidance for working with the Zoho Inventory connector.

## Project Overview

`@hasna/connect-zoho-inventory` is a TypeScript connector for the Zoho Inventory API v1 with OAuth token authentication and multi-profile CLI configuration.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

- Header: `Authorization: Zoho-oauthtoken {token}`
- Required query param: `organization_id`
- Default base URL: `https://www.zohoapis.com/inventory/v1`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZOHOINVENTORY_TOKEN` | OAuth access token |
| `ZOHOINVENTORY_ORG_ID` | Organization ID |
| `ZOHOINVENTORY_BASE_URL` | Optional regional API base URL |

## API Surface

- `listContacts`, `listItems`, `getItem`, `listSalesOrders`, `listPurchaseOrders`, `listInvoices`
- `ZohoInventoryClient.rawRequest()` for escape hatch calls

## Profile Storage

`~/.hasna/connectors/connect-zoho-inventory/profiles/`
