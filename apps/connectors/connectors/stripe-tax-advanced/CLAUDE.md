# CLAUDE.md

## Project Overview

connect-stripe-tax-advanced is a TypeScript CLI for the official Stripe Tax API (`https://api.stripe.com/v1/tax/*`). It follows the same auth and request patterns as connect-stripe.

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test
```

## API Resources

- **Calculations** — `POST/GET /tax/calculations`, line items
- **Transactions** — create from calculation, reversals, line items
- **Registrations** — CRUD on `/tax/registrations`
- **Settings** — `GET/PATCH /tax/settings`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STRIPE_API_KEY` | Stripe secret key |
| `STRIPE_ACCOUNT_ID` | Required for `sk_org_*` keys |
| `STRIPE_BASE_URL` | Override API base (default `https://api.stripe.com/v1`) |

## Docs

- https://docs.stripe.com/tax
- https://docs.stripe.com/api/tax
