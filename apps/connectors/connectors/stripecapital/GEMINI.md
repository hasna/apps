# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-stripecapital is a TypeScript CLI and library for the Stripe Capital API
(Capital for platforms). It provides read/acknowledge access to financing offers,
and the account financing summary.

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

# Tests
bun test
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
│   ├── client.ts              # HTTP client (Bearer auth, form-urlencoded)
│   ├── financing-offers.ts    # /v1/capital/financing_offers
│   ├── financing-summary.ts   # /v1/capital/financing_summary
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

## API Surface

Public Stripe Capital REST endpoints (https://docs.stripe.com/api/capital):

- **Financing offers** — `GET /v1/capital/financing_offers`,
  `GET /v1/capital/financing_offers/:id`,
  `POST /v1/capital/financing_offers/:id/mark_delivered`
- **Financing summary** — `GET /v1/capital/financing_summary`

## Authentication

Bearer auth with a platform secret key against `https://api.stripe.com/v1`.
Set a connected account (`Stripe-Account` header) to scope calls to a subaccount.

Credentials can be set via:
- Environment variable `STRIPE_CAPITAL_API_KEY` (and optional `STRIPE_CAPITAL_ACCOUNT_ID`)
- Profile configuration: `connect-stripecapital config set-key <key>`

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
