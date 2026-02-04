# connect-stripe

Stripe API connector - A TypeScript CLI for interacting with the Stripe API with multi-profile support

## Installation

```bash
bun install -g @hasna/connect-stripe
```

## Quick Start

```bash
# Set your API key
connect-stripe config set-key YOUR_API_KEY

# Or use environment variable
export STRIPE_API_KEY=YOUR_API_KEY
```

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

## Profile Management

```bash
# Create profiles for different accounts
connect-stripe profile create work --api-key xxx --use
connect-stripe profile create personal --api-key yyy

# Switch profiles
connect-stripe profile use work

# Use profile for single command
connect-stripe -p personal <command>

# List profiles
connect-stripe profile list
```

## Library Usage

```typescript
import { Stripe } from '@hasna/connect-stripe';

const client = new Stripe({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STRIPE_API_KEY` | Stripe API key (overrides profile) |
| `STRIPE_API_SECRET` | Webhook signing secret (optional) |
| `STRIPE_BASE_URL` | Override base URL |

## Data Storage

Configuration stored in `~/.connect/connect-stripe/`:

```
~/.connect/connect-stripe/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Development

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build
bun run build

# Type check
bun run typecheck
```

## License

MIT
