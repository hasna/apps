# connect-squarespace

Squarespace Commerce API connector — Products, Orders, Inventory, Transactions, Profiles, Store Pages, Membership, Forms, and Webhooks.

## Installation

```bash
bun install -g @hasna/connect-squarespace
```

## Quick Start

```bash
# Set API key (generate in Squarespace dashboard)
connect-squarespace config set-key YOUR_API_KEY

# Or use environment variable
export SQUARESPACE_API_KEY=YOUR_API_KEY
```

## CLI Commands

### Inventory
```bash
connect-squarespace inventory list
connect-squarespace inventory get <variantId> [variantId...]
connect-squarespace inventory adjust --data '{"incrementOperations":[...]}'
```

### Orders
```bash
connect-squarespace orders list
connect-squarespace orders get <id>
connect-squarespace orders create --data '{"lineItems":[...]}'
connect-squarespace orders fulfill <id> --data '{"shipments":[...]}'
connect-squarespace orders refund <id> --data '{"idempotencyKey":"...","amounts":[...]}'
```

### Products
```bash
connect-squarespace products list
connect-squarespace products get <id>
connect-squarespace products create --data '{"storePageId":"...","type":"PHYSICAL","name":"..."}'
connect-squarespace products update <id> --data '{"name":"Updated"}'
connect-squarespace products delete <id>
```

### Transactions
```bash
connect-squarespace transactions list
connect-squarespace transactions get <id>
```

### Profiles
```bash
connect-squarespace profiles list
connect-squarespace profiles get <id>
connect-squarespace profiles create --data '{"email":"user@example.com"}'
```

### Store Pages, Membership, Forms, Webhooks
```bash
connect-squarespace store-pages list
connect-squarespace membership plans
connect-squarespace membership members
connect-squarespace forms list
connect-squarespace webhooks list
```

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
| `SQUARESPACE_API_KEY` | Commerce API key (Bearer token) |

## API Reference

- Base URL: `https://api.squarespace.com/1.0`
- Auth: `Authorization: Bearer <api_key>`
- Docs: https://developers.squarespace.com/commerce-apis/overview

## License

Apache-2.0
