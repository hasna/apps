# AGENTS.md

## Overview

`connect-whop` is a TypeScript connector for the Whop API v1 (memberships, plans, products, payments, webhooks, promo codes, reviews, affiliates).

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Auth

Bearer API key via `WHOP_API_KEY` or profile config. Optional `WHOP_COMPANY_ID` for company-scoped list endpoints.

## Patterns

- HTTP client: `src/api/client.ts` (retry on 429/5xx, `Api-Version-Date` header)
- Resource APIs: `src/api/{resource}.ts`
- Main class: `Whop` in `src/api/index.ts`
- Profiles: `~/.hasna/connectors/connect-whop/profiles/`

## Security

Never commit API keys. `.env.example` contains placeholders only.
