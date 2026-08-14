# connect-stripe-terminal

Stripe Terminal API connector — manage in-person payment hardware, locations, readers, and configurations.

## Installation

```bash
bun install -g @hasna/connect-stripe-terminal
```

## Quick Start

```bash
# Set your Stripe secret key (same key used for Stripe API)
connect-stripe-terminal config set-key sk_test_...

# Or use environment variable
export STRIPE_TERMINAL_API_KEY=sk_test_...

# List terminal locations
connect-stripe-terminal locations list

# Create a connection token for Terminal SDK
connect-stripe-terminal connection-tokens create
```

## CLI Commands

### Profile & Config

```bash
connect-stripe-terminal profile list
connect-stripe-terminal profile use <name>
connect-stripe-terminal profile create <name> --api-key <key>
connect-stripe-terminal config set-key <key>
connect-stripe-terminal config set-account <acct_id>   # for org API keys
connect-stripe-terminal config show
```

### Connection Tokens

```bash
connect-stripe-terminal connection-tokens create [--location <id>]
```

### Locations

```bash
connect-stripe-terminal locations list [--limit 10]
connect-stripe-terminal locations get <id>
connect-stripe-terminal locations create --display-name "Store Front" --line1 "123 Main St" --city "San Francisco" --postal-code 94103 --country US
connect-stripe-terminal locations update <id> --display-name "New Name"
connect-stripe-terminal locations delete <id>
```

### Readers

```bash
connect-stripe-terminal readers list [--location <id>]
connect-stripe-terminal readers get <id>
connect-stripe-terminal readers create --registration-code <code> --label "Front Counter"
connect-stripe-terminal readers process-payment-intent <reader_id> --payment-intent pi_xxx
connect-stripe-terminal readers cancel-action <id>
connect-stripe-terminal readers delete <id>
```

### Configurations

```bash
connect-stripe-terminal configurations list
connect-stripe-terminal configurations get <id>
connect-stripe-terminal configurations create --name "Default"
connect-stripe-terminal configurations delete <id>
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STRIPE_TERMINAL_API_KEY` | Stripe secret API key |
| `STRIPE_TERMINAL_ACCOUNT_ID` | Account ID for org API keys |
| `STRIPE_TERMINAL_API_VERSION` | Stripe API version header |
| `STRIPE_TERMINAL_BASE_URL` | Override API base URL |

## API Reference

Uses the official [Stripe Terminal API](https://stripe.com/docs/api/terminal) at `https://api.stripe.com/v1/terminal/*`.

## License

Apache-2.0
