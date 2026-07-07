# AGENTS.md

Stripe Issuing API connector — TypeScript CLI using Commander.js and the official Stripe Issuing REST API.

## Build

```bash
bun install && bun run typecheck && bun run build
```

## Auth

Bearer token via `STRIPE_ISSUING_API_KEY` or profile config at `~/.hasna/connectors/stripe-issuing/profiles/`.

## Key Files

- `src/api/client.ts` — HTTP client (Stripe form encoding)
- `src/api/index.ts` — Connector class
- `src/cli/index.ts` — CLI entry
- `src/utils/config.ts` — Multi-profile config

## No browser-use

This connector uses the real Stripe HTTP API only. No Playwright or scraper dependencies.
