# CLAUDE.md

Stripe Sigma connector — SQL analytics via `POST/GET /v1/sigma/query_runs` on `api.stripe.com`.

## Commands

```bash
bun install
bun run dev          # CLI from source
bun run typecheck
bun run build
bun test src/api
```

## Auth

Bearer token with Stripe secret key (`sk_test_*` / `sk_live_*`). Same key as connect-stripe. Sigma must be enabled on the account.

Config: `~/.hasna/connectors/stripe-sigma/profiles/`. Env: `STRIPE_SIGMA_API_KEY` or `STRIPE_API_KEY`.

## API version

Sigma query runs require a preview `Stripe-Version` header (default `2025-06-30.preview`). Set via profile or `STRIPE_SIGMA_API_VERSION`.

## Structure

```
src/api/client.ts       # Stripe HTTP transport (form-urlencoded POST)
src/api/query-runs.ts   # Query Runs resource
src/cli/index.ts        # Commander CLI
src/utils/config.ts     # Multi-profile storage
```

## CLI

```bash
stripe-sigma query-runs create --sql "SELECT 1"
stripe-sigma query-runs get qry_xxx
stripe-sigma config set-key sk_test_...
```

## Docs

- https://docs.stripe.com/api/sigma/query_runs
