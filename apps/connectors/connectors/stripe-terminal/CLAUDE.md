# CLAUDE.md

## Project Overview

connect-stripe-terminal is a TypeScript CLI for the Stripe Terminal API (in-person payments hardware and POS). Uses standard Stripe Bearer authentication against `https://api.stripe.com/v1/terminal/*`.

## Build & Run

```bash
bun install
bun run dev -- --help
bun run build
bun run typecheck
```

## Structure

```
src/
├── api/
│   ├── client.ts              # Stripe HTTP client (form-urlencoded, Stripe-Version)
│   ├── connection-tokens.ts   # POST /terminal/connection_tokens
│   ├── locations.ts           # CRUD /terminal/locations
│   ├── readers.ts             # CRUD + actions /terminal/readers
│   ├── configurations.ts      # CRUD /terminal/configurations
│   └── index.ts               # Connector class
├── cli/index.ts
├── types/index.ts
├── utils/config.ts            # ~/.hasna/connectors/stripe-terminal/
└── utils/output.ts
```

## Authentication

Bearer token via `STRIPE_TERMINAL_API_KEY` or `config set-key`. Organization keys (`sk_org_*`) require `config set-account <acct_id>`.

## Key API Modules

- **connection-tokens**: SDK connection secrets
- **locations**: Physical store locations for readers
- **readers**: Hardware registration and payment processing
- **configurations**: Reader tipping/offline/wifi settings

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STRIPE_TERMINAL_API_KEY` | Stripe secret key |
| `STRIPE_TERMINAL_ACCOUNT_ID` | Org account context |
| `STRIPE_TERMINAL_API_VERSION` | API version header |

## Data Storage

`~/.hasna/connectors/stripe-terminal/profiles/`
