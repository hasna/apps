# AGENTS.md

## Overview

`@hasna/connect-stripe-tax-advanced` — Stripe Tax API connector (calculations, transactions, registrations, settings).

## Structure

```
src/
├── api/       # HTTP client + resource modules
├── cli/       # Commander CLI
├── types/     # TypeScript types
└── utils/     # config + output
```

## Auth

Bearer token via `STRIPE_API_KEY` or profile config. Organization keys require `STRIPE_ACCOUNT_ID`.

## No browser-use

This connector uses the official Stripe REST API only.
