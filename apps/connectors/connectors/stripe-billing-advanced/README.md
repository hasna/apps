# Stripe Billing Advanced Connector

TypeScript CLI and library for Stripe **Advanced Usage-Based Billing** via the public `https://api.stripe.com/v2/billing/*` API.

This connector targets Stripe's v2 billing endpoints (pricing plans, rate cards, billing profiles, cadences, and billing intents). It uses JSON request bodies, Bearer `sk_*` authentication, and the `Stripe-Version` preview header (default `2026-05-27.preview`).

> **Note:** This is distinct from the standard `connect-stripe` connector, which uses Stripe v1 form-encoded endpoints.

## Install

```bash
bun install
```

## Development

```bash
bun run dev -- --help
bun run typecheck
bun test
bun run build
```

## Authentication

Bearer token (Stripe secret key). Configure via profile or environment:

```bash
export STRIPE_BILLING_ADVANCED_API_KEY=sk_test_...
connect-stripe-billing-advanced config set-key sk_test_...
```

Optional:

- `STRIPE_BILLING_ADVANCED_API_VERSION` — override `Stripe-Version` header
- `STRIPE_BILLING_ADVANCED_BASE_URL` — override API host (default `https://api.stripe.com`)

## CLI Examples

```bash
# Pricing plans
connect-stripe-billing-advanced pricing-plans list
connect-stripe-billing-advanced pricing-plans get pp_xxx
connect-stripe-billing-advanced pricing-plans create --display-name "Pro" --currency usd

# Rate cards
connect-stripe-billing-advanced rate-cards list
connect-stripe-billing-advanced rate-cards create --data '{"display_name":"API Usage","currency":"usd"}'

# Billing profiles, cadences, intents
connect-stripe-billing-advanced billing-profiles create --data '{"customer":"cus_xxx"}'
connect-stripe-billing-advanced cadences create --data '{"payer":{"billing_profile":"bp_xxx"},...}'
connect-stripe-billing-advanced intents create --data '{"currency":"usd","cadence":"bc_xxx",...}'

# Escape hatch
connect-stripe-billing-advanced raw-request --path /pricing_plans --method GET
```

## Documentation

- [Advanced usage-based billing](https://docs.stripe.com/billing/subscriptions/usage-based/advanced/about)
- [Pricing plans guide](https://docs.stripe.com/billing/subscriptions/usage-based/pricing-plans)

## License

Apache-2.0
