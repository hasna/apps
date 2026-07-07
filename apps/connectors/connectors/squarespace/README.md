# connect-squarespace

Squarespace Commerce API connector - Products, Orders, Inventory, Transactions, Profiles, Store Pages, and Webhooks.

## Installation

```bash
bun install -g @hasna/connect-squarespace
```

## Quick Start

```bash
# Set API key (generate in Squarespace dashboard)
connect-squarespace config set-key your-squarespace-token

# Or export SQUARESPACE_API_KEY from your local shell
export SQUARESPACE_API_KEY
```

## CLI Commands

### Inventory
```bash
connect-squarespace inventory list
connect-squarespace inventory get <variantId> [variantId...]
connect-squarespace inventory adjust --idempotency-key <key> --data '{"incrementOperations":[...]}'
```

### Orders
```bash
connect-squarespace orders list
connect-squarespace orders get <id>
connect-squarespace orders create --idempotency-key <key> --data '{"lineItems":[...]}'
connect-squarespace orders fulfill <id> --data '{"shipments":[...]}'
```

### Products
```bash
connect-squarespace products list
connect-squarespace products get <id>
connect-squarespace products create --data '{"storePageId":"...","type":"PHYSICAL","name":"..."}'
connect-squarespace products update <id> --data '{"name":{"present":true,"value":"Updated"}}'
connect-squarespace products delete <id>
connect-squarespace products associate-variant-image <productId> <variantId> --image-id <imageId>
```

### Transactions
```bash
connect-squarespace transactions list
connect-squarespace transactions get <id> [id...]
```

### Profiles
```bash
connect-squarespace profiles list
connect-squarespace profiles get <id> [id...]
```

### Store Pages and Webhooks
```bash
connect-squarespace store-pages list
connect-squarespace webhooks list
```

Webhook subscription commands require a Squarespace OAuth access token with webhook scopes. Store that access token with `SQUARESPACE_API_KEY` when using `connect-squarespace webhooks ...`.

### Profile & Config
```bash
connect-squarespace profile list
connect-squarespace profile use <name>
connect-squarespace config set-key <key>
connect-squarespace config show
```

## Programmatic API

```typescript
import { Squarespace } from '@hasna/connect-squarespace';

const client = Squarespace.fromEnv();
const products = await client.products.list();
const orders = await client.orders.list({ fulfillmentStatus: 'PENDING' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SQUARESPACE_API_KEY` | Commerce API key or OAuth access token (Bearer token) |

## API Reference

- Base URL: `https://api.squarespace.com/1.0`
- Products API: `https://api.squarespace.com/v2/commerce/products`
- Auth: `Authorization: Bearer <token>`
- Order creation and inventory adjustment require an `Idempotency-Key` header.
- Docs: https://developers.squarespace.com/commerce-apis/overview

## License

Apache-2.0
