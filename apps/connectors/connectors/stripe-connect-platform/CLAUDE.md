# CLAUDE.md

Stripe Connect Platform connector for platform/marketplace operations against the official Stripe API.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## API

Base URL: `https://api.stripe.com/v1` (Stripe Connect uses the same API as Stripe).

Modules: accounts, account-links, login-links, transfers, application-fees, raw request.

Auth: Bearer platform secret key. Supports `Stripe-Account` (connected account) and `Stripe-Context` (org keys).

## Environment

`STRIPE_CONNECT_PLATFORM_API_KEY` — required platform secret key.

## Docs

https://docs.stripe.com/connect
