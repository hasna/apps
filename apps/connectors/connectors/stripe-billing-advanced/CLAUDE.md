# CLAUDE.md

## Project Overview

`connect-stripe-billing-advanced` is a TypeScript CLI for Stripe Advanced Usage-Based Billing (`/v2/billing/*`). Bearer token auth, JSON bodies, `Stripe-Version` preview header.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer Token. Set via `STRIPE_BILLING_ADVANCED_API_KEY` or `connect-stripe-billing-advanced config set-key <sk_*>`.

## API

- Base: `https://api.stripe.com`
- Prefix: `/v2/billing`
- Default version: `2026-05-27.preview`

## CLI resource groups

- `pricing-plans` — list, get, create
- `rate-cards` — list, get, create
- `billing-profiles` — get, create
- `cadences` — get, create
- `intents` — get, create
- `raw-request` — other `/v2/billing` paths

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STRIPE_BILLING_ADVANCED_API_KEY` | Stripe secret key |
| `STRIPE_BILLING_ADVANCED_API_VERSION` | Stripe-Version header |
| `STRIPE_BILLING_ADVANCED_BASE_URL` | API base URL override |
