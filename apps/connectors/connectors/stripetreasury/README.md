# connect-stripetreasury

Stripe Treasury API connector - A TypeScript CLI for managing financial accounts and money movement (outbound payments, transfers, received flows, and reversals) with multi-profile support.

## Installation

```bash
bun install -g @hasna/connect-stripetreasury
```

## Quick Start

```bash
# Set your API key
connect-stripetreasury config set-key YOUR_API_KEY

# Or use environment variable
export STRIPE_API_KEY=YOUR_API_KEY

# Treasury financial accounts belong to connected accounts on your platform.
# Optionally target one via the Stripe-Account header:
connect-stripetreasury config set-account acct_xxx
```

## What is Stripe Treasury?

[Stripe Treasury](https://stripe.com/docs/treasury) is a banking-as-a-service API
that lets platforms embed financial accounts and move money on behalf of their
connected accounts. It is a subset of the public Stripe API: same base URL
(`https://api.stripe.com/v1`), Bearer authentication, and form-urlencoded
request bodies. All resources live under the `/treasury` path.

## CLI Commands

### Financial Accounts

```bash
connect-stripetreasury financial-accounts list
connect-stripetreasury financial-accounts get fa_xxx
connect-stripetreasury financial-accounts create --currencies usd --nickname "Operating"
connect-stripetreasury financial-accounts features fa_xxx
```

### Outbound Payments & Transfers

```bash
# Outbound payment to a third party
connect-stripetreasury outbound-payments create \
  --financial-account fa_xxx --amount 5000 --currency usd \
  --destination-payment-method pm_xxx
connect-stripetreasury outbound-payments list --financial-account fa_xxx
connect-stripetreasury outbound-payments cancel obp_xxx

# Outbound transfer to an owned external account
connect-stripetreasury outbound-transfers create \
  --financial-account fa_xxx --amount 5000 --currency usd \
  --destination-payment-method pm_xxx
```

### Inbound Transfers

```bash
connect-stripetreasury inbound-transfers create \
  --financial-account fa_xxx --amount 5000 --currency usd \
  --origin-payment-method pm_xxx
```

### Transactions & Received Flows

```bash
connect-stripetreasury transactions list --financial-account fa_xxx
connect-stripetreasury transaction-entries list --financial-account fa_xxx
connect-stripetreasury received-credits list --financial-account fa_xxx
connect-stripetreasury received-debits list --financial-account fa_xxx
```

### Reversals

```bash
connect-stripetreasury credit-reversals create --received-credit rc_xxx
connect-stripetreasury debit-reversals create --received-debit rd_xxx
```

### Profiles

```bash
connect-stripetreasury profile list
connect-stripetreasury profile create work --api-key sk_test_xxx --use
connect-stripetreasury --profile work financial-accounts list
```

## Output Formats

Use `--format json` for machine-readable output or `--format pretty` (default) for
human-readable output:

```bash
connect-stripetreasury financial-accounts list --format json
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STRIPE_API_KEY` | Stripe API key (overrides profile) |
| `STRIPE_ACCOUNT_ID` | Connected account ID for the `Stripe-Account` header (optional) |
| `STRIPE_BASE_URL` | Override base URL (optional) |

## Library Usage

```typescript
import { StripeTreasury } from '@hasna/connect-stripetreasury';

const client = StripeTreasury.fromEnv();
const accounts = await client.financialAccounts.list({ limit: 10 });
console.log(accounts.data);
```

## License

Apache-2.0
