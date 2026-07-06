# connect-stripeclimate

Stripe Climate API connector — a TypeScript CLI and library for Stripe Climate carbon removal **products**, **suppliers**, and **orders** with multi-profile support.

Built against the public Stripe Climate API: https://docs.stripe.com/api/climate

## Installation

```bash
bun install -g @hasna/connect-stripeclimate
```

## Quick Start

```bash
# Set your API key
connect-stripeclimate config set-key sk_test_...

# Or use an environment variable
export STRIPE_API_KEY=sk_test_...

# Browse available carbon removal products
connect-stripeclimate products list

# Place an order for 1.5 metric tons of a product
connect-stripeclimate orders create --product climsku_... --metric-tons 1.5 --beneficiary "Acme Corp"
```

## CLI Commands

```bash
# Products
connect-stripeclimate products list [--limit <n>] [--starting-after <id>]
connect-stripeclimate products get <id>

# Suppliers
connect-stripeclimate suppliers list [--limit <n>]
connect-stripeclimate suppliers get <id>

# Orders
connect-stripeclimate orders list [--limit <n>]
connect-stripeclimate orders get <id>
connect-stripeclimate orders create --product <id> (--amount <n> | --metric-tons <t>) [--currency <code>] [--beneficiary <name>] [--metadata <json>]
connect-stripeclimate orders update <id> [--beneficiary <name>] [--metadata <json>]
connect-stripeclimate orders cancel <id>

# Config & profiles
connect-stripeclimate config set-key <key>
connect-stripeclimate config set-account <acct_id>
connect-stripeclimate config show
connect-stripeclimate profile list
connect-stripeclimate profile use <name>
```

## Profile Management

```bash
# Create profiles for different accounts
connect-stripeclimate profile create work --api-key sk_live_... --use
connect-stripeclimate profile create sandbox --api-key sk_test_...

# Switch profiles
connect-stripeclimate profile use work

# Use a profile for a single command
connect-stripeclimate -p sandbox products list
```

## Library Usage

```typescript
import { StripeClimate } from '@hasna/connect-stripeclimate';

const client = new StripeClimate({ apiKey: process.env.STRIPE_API_KEY! });

// List carbon removal products
const products = await client.products.list({ limit: 10 });

// Create an order
const order = await client.orders.create({
  product: 'climsku_...',
  metric_tons: '1.5',
  beneficiary: { public_name: 'Acme Corp' },
});

// Cancel it
await client.orders.cancel(order.id);
```

## Environment Variables

| Variable             | Description                                                        |
|----------------------|--------------------------------------------------------------------|
| `STRIPE_API_KEY`     | Stripe secret API key (required)                                   |
| `STRIPE_ACCOUNT_ID`  | Connected account ID for Stripe Connect (`Stripe-Account` header)  |
| `STRIPE_BASE_URL`    | Override the API base URL (defaults to `https://api.stripe.com/v1`)|

## Data Storage

Configuration is stored in `~/.hasna/connectors/stripeclimate/`:

```
~/.hasna/connectors/stripeclimate/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Development

```bash
bun install       # Install dependencies
bun run dev       # Run the CLI in development
bun run build     # Build dist/ and bin/
bun run typecheck # Type check
bun test          # Run tests
```

## License

Apache-2.0
