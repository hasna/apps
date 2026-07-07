# connect-stripecapital

Stripe Capital API connector CLI - financing offers and financing summary for [Capital for platforms](https://docs.stripe.com/capital/api-integration).

## Installation

```bash
bun install -g @hasna/connect-stripecapital
```

## Quick Start

```bash
# Set your platform API key
connect-stripecapital config set-key <stripe_secret_key>

# Or use an environment variable
export STRIPE_CAPITAL_API_KEY=<stripe_secret_key>

# Optionally act on behalf of a connected account
connect-stripecapital config set-account acct_...
```

## CLI Commands

```bash
# Financing offers
connect-stripecapital offers list [-l limit] [--status <status>] [--connected-account <acct>]
connect-stripecapital offers get <financingOfferId>
connect-stripecapital offers mark-delivered <financingOfferId> [--metadata '{"k":"v"}']

# Financing summary (real-time repayment status)
connect-stripecapital summary

# Config
connect-stripecapital config set-key <key>
connect-stripecapital config set-account <acct_id>
connect-stripecapital config show

# Profiles
connect-stripecapital profile list|use|create|delete|show
```

Add `-f json` to any command for machine-readable output, `-a acct_...` to scope a
single call to a connected account, and `-p <profile>` to select a profile.

## Library Usage

```ts
import { StripeCapital } from '@hasna/connect-stripecapital';

const capital = StripeCapital.fromEnv(); // reads STRIPE_CAPITAL_API_KEY

const offers = await capital.financingOffers.list({ status: 'delivered', limit: 10 });
const summary = await capital.financingSummary.retrieve();
```

## Authentication

Stripe Capital uses your platform's Stripe secret key with Bearer authentication
against `https://api.stripe.com/v1`. To read data for a connected account, pass its
account ID (sent as the `Stripe-Account` header) via `--account`, `config set-account`,
or `STRIPE_CAPITAL_ACCOUNT_ID`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STRIPE_CAPITAL_API_KEY` | Platform secret API key (overrides profile) |
| `STRIPE_CAPITAL_ACCOUNT_ID` | Optional connected account (Stripe-Account header) |
| `STRIPE_CAPITAL_BASE_URL` | Optional API base URL override |

## Data Storage

```
~/.hasna/connectors/stripecapital/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling

## License

Apache-2.0
