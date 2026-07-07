# CLAUDE.md

Stripe Webhooks Advanced connector — webhook endpoints, events, and signature verification against the official Stripe API.

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test
bun run build
```

## Structure

```
src/
├── api/
│   ├── client.ts    # Stripe HTTP client (Bearer + form encoding)
│   ├── webhooks.ts  # /webhook_endpoints
│   ├── events.ts    # /events
│   ├── verify.ts    # Local signature verification
│   └── index.ts     # Connector class
├── cli/index.ts
├── types/index.ts
└── utils/{config,output}.ts
```

## Auth

Bearer token (`STRIPE_WEBHOOKS_ADVANCED_API_KEY`). Webhook signing secret (`STRIPE_WEBHOOKS_ADVANCED_API_SECRET`) for `verify` commands.

Config: `~/.hasna/connectors/stripe-webhooks-advanced/profiles/`

## Relationship to connect-stripe

The full `connectors/stripe/` package covers the entire Stripe API. This connector is webhook-specialized and does not depend on `@hasna/connect-stripe`.
