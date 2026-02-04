# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-stripe is a TypeScript CLI for interacting with the Stripe API. It provides multi-profile configuration, Bearer token authentication, and a clean CLI structure using Commander.js.

## Build & Run Commands

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build for distribution
bun run build

# Type check
bun run typecheck
```

## Code Style

- TypeScript with strict mode
- ESM modules (`type: module`)
- Async/await for all async operations
- Minimal dependencies: commander, chalk
- Type annotations required everywhere

## Project Structure

```
src/
├── api/           # API client modules
│   ├── client.ts  # HTTP client with authentication
│   └── index.ts   # Main connector class
├── cli/
│   └── index.ts   # CLI commands
├── types/
│   └── index.ts   # TypeScript types
├── utils/
│   ├── config.ts  # Multi-profile configuration
│   └── output.ts  # CLI output formatting
└── index.ts       # Library exports
```

## Authentication

Bearer Token authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-stripe config set-key <key>`


## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/connect-stripe/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### Authentication

Uses Bearer token for Stripe API in `src/api/client.ts`:
```typescript
'Authorization': `Bearer ${this.apiKey}`,
```

### Request Encoding

Stripe uses form-urlencoded bodies for POST/PUT/PATCH requests with nested object support:
```typescript
// Input: { metadata: { order_id: '123' } }
// Encoded: metadata[order_id]=123
```

### Adding New Stripe API Modules

1. Create file in `src/api/` following existing pattern (e.g., `products.ts`)
2. Add to imports/exports in `src/api/index.ts`
3. Add types in `src/types/index.ts`
4. Add CLI commands in `src/cli/index.ts`

## CLI Commands

### Link Generation (for testing payments)

```bash
# Create a one-time checkout session (returns a payment URL)
connect-stripe checkout create --mode payment --price price_xxx --success-url "https://example.com/success" --cancel-url "https://example.com/cancel"

# Create a subscription checkout
connect-stripe checkout create --mode subscription --price price_xxx --customer cus_xxx

# List checkout sessions
connect-stripe checkout list [--customer <id>] [--status open]

# Create a reusable payment link
connect-stripe payment-links create --price price_xxx --quantity 1

# List and manage payment links
connect-stripe payment-links list
connect-stripe payment-links deactivate <id>

# Create a billing portal session for customer self-service
connect-stripe billing-portal create-session --customer cus_xxx --return-url "https://example.com/account"
```

### Profile & Config Management

```bash
# Profile management
connect-stripe profile list
connect-stripe profile use <name>
connect-stripe profile create <name> --api-key <key>

# Configuration
connect-stripe config set-key <key>
connect-stripe config show
```

### Products & Prices

```bash
# Products
connect-stripe products list [--limit 10] [--active true]
connect-stripe products get <id>
connect-stripe products create --name "Product Name"
connect-stripe products update <id> --name "New Name"
connect-stripe products delete <id>
connect-stripe products search --query "name~'shirt'"

# Prices
connect-stripe prices list [--product <id>]
connect-stripe prices create --product <id> --currency usd --unit-amount 1999
connect-stripe prices search --query "product:'prod_xxx'"
```

### Customers & Subscriptions

```bash
# Customers
connect-stripe customers list [--email <email>]
connect-stripe customers create --email "test@example.com"
connect-stripe customers search --query "email:'test@example.com'"

# Subscriptions
connect-stripe subscriptions list [--customer <id>] [--status active]
connect-stripe subscriptions create --customer <id> --price <id>
connect-stripe subscriptions cancel <id> [--prorate]
connect-stripe subscriptions resume <id>
```

### Payments & Billing

```bash
# Payment Intents
connect-stripe payment-intents create --amount 1999 --currency usd
connect-stripe payment-intents confirm <id>
connect-stripe payment-intents capture <id>

# Invoices
connect-stripe invoices list [--status open]
connect-stripe invoices create --customer <id>
connect-stripe invoices finalize <id>
connect-stripe invoices pay <id>
connect-stripe invoices void <id>

# Coupons
connect-stripe coupons create --duration once --percent-off 25
connect-stripe coupons create --duration repeating --amount-off 500 --currency usd --duration-in-months 3

# Webhooks
connect-stripe webhooks create --url "https://..." --events invoice.paid,customer.created
connect-stripe webhooks list
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STRIPE_API_KEY` | Stripe API key (overrides profile) |
| `STRIPE_API_SECRET` | Webhook signing secret (optional) |
| `STRIPE_BASE_URL` | Override base URL |

## Data Storage

```
~/.connect/connect-stripe/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
