# connect-walmart-marketplace

TypeScript connector for the [Walmart Marketplace API v3](https://developer.walmart.com/). Manage items, inventory, and orders with a CLI and programmatic API.

## Features

- OAuth access token authentication (`WM_SEC.ACCESS_TOKEN`)
- Required `WM_SVC.NAME` and `WM_QOS.CORRELATION_ID` headers per Walmart API spec
- Multi-profile configuration
- Items, inventory, and orders list/get commands
- JSON and pretty output formats

## Quick Start

```bash
cd connectors/walmart-marketplace
bun install
bun run dev config set-token <access-token>
bun run dev config set-service-name <your-wm-svc-name>
bun run dev items list
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WALMART_ACCESS_TOKEN` | OAuth access token from Walmart Token API |
| `WALMART_SERVICE_NAME` | Value for `WM_SVC.NAME` header |
| `WALMART_BASE_URL` | Optional API base URL (default: `https://marketplace.walmartapis.com/v3`) |
| `WALMART_CORRELATION_ID` | Optional default correlation ID (auto-generated per request if unset) |

Copy `.env.example` for local development placeholders only — never commit real credentials.

## CLI Commands

```bash
connect-walmart-marketplace items list [--limit N]
connect-walmart-marketplace items get <sku>
connect-walmart-marketplace inventory list [--sku <sku>]
connect-walmart-marketplace inventory get <sku>
connect-walmart-marketplace orders list [--limit N]
connect-walmart-marketplace orders get <purchaseOrderId>
connect-walmart-marketplace profile list|use|create|delete|show
connect-walmart-marketplace config set-token|set-service-name|show|clear
```

## Programmatic Usage

```typescript
import { WalmartMarketplace } from '@hasna/connect-walmart-marketplace';

const walmart = new WalmartMarketplace({
  accessToken: process.env.WALMART_ACCESS_TOKEN!,
  serviceName: process.env.WALMART_SERVICE_NAME!,
});

const items = await walmart.items.list({ limit: 20 });
const order = await walmart.orders.get('123456789');
```

## Configuration Storage

Profiles are stored at `~/.hasna/connectors/connect-walmart-marketplace/profiles/`.

## License

Apache-2.0
