# connect-stripe-tax-advanced

TypeScript CLI and library for the [Stripe Tax API](https://docs.stripe.com/tax).

## Features

- Tax calculations, transactions, registrations, and settings
- Bearer authentication with Stripe API version pinning
- Multi-profile configuration at `~/.hasna/connectors/stripe-tax-advanced/`
- JSON and pretty CLI output

## Install

```bash
bun install
```

## Configuration

```bash
export STRIPE_API_KEY=sk_test_...
# Optional for organization keys:
export STRIPE_ACCOUNT_ID=acct_...

connect-stripe-tax-advanced config set-key sk_test_...
```

## Usage

```bash
# Tax settings (health check)
connect-stripe-tax-advanced settings get

# Create a tax calculation
connect-stripe-tax-advanced calculations create \
  --currency usd \
  --line-items '[{"amount":1000,"reference":"item-1"}]'

# List registrations
connect-stripe-tax-advanced registrations list --limit 10
```

## Development

```bash
bun run dev -- settings get
bun run typecheck
bun test
```

## License

Apache-2.0
