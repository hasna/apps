# GEMINI.md

This file provides guidance to Gemini when working with this repository.

## Project Overview

connect-stripetreasury is a TypeScript CLI for interacting with the Stripe Treasury API. It manages treasury financial accounts and the money-movement flows built on top of them: outbound payments, outbound/inbound transfers, received credits/debits, and credit/debit reversals. It provides multi-profile configuration, Bearer token authentication, and a clean CLI structure using Commander.js.

Stripe Treasury is a subset of the public Stripe API, so it shares the same base URL (`https://api.stripe.com/v1`), Bearer authentication, form-urlencoded request bodies, and `Stripe-Version` header. All Treasury resources live under the `/treasury` path.

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
├── api/                       # API client modules
│   ├── client.ts              # HTTP client with authentication
│   ├── financial-accounts.ts  # Financial accounts + features
│   ├── transactions.ts        # Transactions (read-only)
│   ├── transaction-entries.ts # Transaction entries (read-only)
│   ├── outbound-payments.ts   # Outbound payments
│   ├── outbound-transfers.ts  # Outbound transfers
│   ├── inbound-transfers.ts   # Inbound transfers
│   ├── received-credits.ts    # Received credits (read-only)
│   ├── received-debits.ts     # Received debits (read-only)
│   ├── credit-reversals.ts    # Credit reversals
│   ├── debit-reversals.ts     # Debit reversals
│   └── index.ts               # Main connector class
├── cli/
│   └── index.ts               # CLI commands
├── types/
│   └── index.ts               # TypeScript types
├── utils/
│   ├── config.ts              # Multi-profile configuration
│   └── output.ts              # CLI output formatting
└── index.ts                   # Library exports
```

## Authentication

Bearer Token authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-stripetreasury config set-key <key>`

Treasury financial accounts belong to connected accounts on your platform. Set a
connected account ID with `connect-stripetreasury config set-account acct_xxx`
(or `STRIPE_ACCOUNT_ID`) to send the `Stripe-Account` header on every request.

## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.hasna/connectors/stripetreasury/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### Request Encoding

Stripe uses form-urlencoded bodies for POST requests with nested object support:

```typescript
// Input: { metadata: { order_id: '123' } }
// Encoded: metadata[order_id]=123
```

### Adding New Treasury API Modules

1. Create file in `src/api/` following the existing pattern (e.g. `outbound-payments.ts`)
2. Add to imports/exports in `src/api/index.ts`
3. Add types in `src/types/index.ts`
4. Add CLI commands in `src/cli/index.ts`

## CLI Commands

### Profile & Config Management

```bash
connect-stripetreasury profile list
connect-stripetreasury profile use <name>
connect-stripetreasury profile create <name> --api-key <key>

connect-stripetreasury config set-key <key>
connect-stripetreasury config set-account acct_xxx
connect-stripetreasury config show
```

### Financial Accounts

```bash
connect-stripetreasury financial-accounts list
connect-stripetreasury financial-accounts get <id>
connect-stripetreasury financial-accounts create --currencies usd --nickname "Operating"
connect-stripetreasury financial-accounts features <id>
```

### Money Movement

```bash
# Outbound payments (to third parties)
connect-stripetreasury outbound-payments create --financial-account fa_xxx --amount 5000 --currency usd --destination-payment-method pm_xxx
connect-stripetreasury outbound-payments list --financial-account fa_xxx
connect-stripetreasury outbound-payments cancel <id>

# Outbound transfers (to owned external accounts)
connect-stripetreasury outbound-transfers create --financial-account fa_xxx --amount 5000 --currency usd --destination-payment-method pm_xxx

# Inbound transfers (pull funds in)
connect-stripetreasury inbound-transfers create --financial-account fa_xxx --amount 5000 --currency usd --origin-payment-method pm_xxx
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

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STRIPE_API_KEY` | Stripe API key (overrides profile) |
| `STRIPE_ACCOUNT_ID` | Connected account ID for the `Stripe-Account` header (optional) |
| `STRIPE_BASE_URL` | Override base URL (optional) |

## Data Storage

```
~/.hasna/connectors/stripetreasury/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
