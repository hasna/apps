# AGENTS.md

Guidance for AI agents working with the Stripe Sigma connector.

## Overview

`@hasna/connect-stripe-sigma` wraps the official Stripe Sigma Query Runs API. Uses real `api.stripe.com` endpoints — not browser automation.

## Commands

```bash
bun install
bun run typecheck
bun test src/api
bun run build
```

## Auth

- Type: Bearer (`sk_test_*` / `sk_live_*`)
- Config dir: `~/.hasna/connectors/stripe-sigma/`
- Env: `STRIPE_SIGMA_API_KEY`, `STRIPE_API_KEY`

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/v1/sigma/query_runs` | Create query run (`sql` or `from_saved_query`) |
| GET | `/v1/sigma/query_runs/:id` | Retrieve status/result |

## Security

- No hardcoded keys
- `.env.example` placeholders only
- No browser automation dependencies

## Registry

Connector slug: `stripe-sigma`. Category: Commerce & Finance.
