# connect-stripe-connect-platform

TypeScript CLI and library for [Stripe Connect](https://docs.stripe.com/connect) platform operations: connected accounts, onboarding links, transfers, and application fees.

Uses the official Stripe API at `https://api.stripe.com/v1` with platform secret keys (`sk_live_*` / `sk_test_*`).

## Quick Start

```bash
bun install
bun run dev config set-key sk_test_...
bun run dev accounts list
```

## Authentication

Set your platform secret key via profile or environment:

```bash
export STRIPE_CONNECT_PLATFORM_API_KEY=sk_test_...
connect-stripe-connect-platform config set-key sk_test_...
```

For organization API keys (`sk_org_*`), also set an account context:

```bash
connect-stripe-connect-platform config set-account acct_...
```

To act on behalf of a connected account, set the Stripe-Account header:

```bash
connect-stripe-connect-platform config set-connected-account acct_...
# or per-command:
connect-stripe-connect-platform --stripe-account acct_... accounts get acct_...
```

## Commands

```bash
# Connected accounts
connect-stripe-connect-platform accounts list
connect-stripe-connect-platform accounts get acct_...
connect-stripe-connect-platform accounts create --type express --country US
connect-stripe-connect-platform accounts delete acct_...

# Onboarding
connect-stripe-connect-platform account-links create \
  --account acct_... --type account_onboarding \
  --refresh-url https://example.com/reauth --return-url https://example.com/return

# Express Dashboard login
connect-stripe-connect-platform login-links create acct_...

# Transfers
connect-stripe-connect-platform transfers list
connect-stripe-connect-platform transfers create --amount 1000 --currency usd --destination acct_...

# Application fees
connect-stripe-connect-platform application-fees list
connect-stripe-connect-platform application-fees refund fee_...

# Raw API access
connect-stripe-connect-platform request call /accounts --param limit=5
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STRIPE_CONNECT_PLATFORM_API_KEY` | Platform secret key |
| `STRIPE_CONNECT_PLATFORM_ACCOUNT_ID` | Org account context (`sk_org_*`) |
| `STRIPE_CONNECT_PLATFORM_CONNECTED_ACCOUNT_ID` | Default connected account |
| `STRIPE_CONNECT_PLATFORM_API_VERSION` | Stripe API version header |
| `STRIPE_CONNECT_PLATFORM_BASE_URL` | API base URL override |

## Data Storage

```
~/.hasna/connectors/stripe-connect-platform/
├── current_profile
└── profiles/
    └── default.json
```

## License

Apache-2.0
