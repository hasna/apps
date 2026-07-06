# connect-zoho-inventory

TypeScript connector for the [Zoho Inventory API](https://www.zoho.com/inventory/api/v1/) with OAuth token authentication and multi-profile configuration.

## Features

- Contacts, items, sales orders, purchase orders, and invoices
- Zoho OAuth token authentication (`Zoho-oauthtoken` header)
- Required `organization_id` on every request
- Multi-profile configuration
- JSON and pretty output formats

## Quick Start

```bash
bun install
export ZOHOINVENTORY_TOKEN=your-oauth-token
export ZOHOINVENTORY_ORG_ID=your-org-id
bun run dev items list
```

## CLI Commands

```bash
connect-zoho-inventory config set-token <token>
connect-zoho-inventory config set-org-id <id>
connect-zoho-inventory contacts list
connect-zoho-inventory items list
connect-zoho-inventory items get <itemId>
connect-zoho-inventory salesorders list
connect-zoho-inventory purchaseorders list
connect-zoho-inventory invoices list
connect-zoho-inventory raw /items --page 1
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZOHOINVENTORY_TOKEN` | OAuth access token |
| `ZOHOINVENTORY_ORG_ID` | Organization ID |
| `ZOHOINVENTORY_BASE_URL` | Optional regional API base URL |

## Development

```bash
bun install
bun run dev
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
