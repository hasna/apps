# CLAUDE.md

Stripe Issuing API connector for card programs, cardholders, cards, authorizations, and transactions.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## API

Official Stripe Issuing endpoints under `https://api.stripe.com/v1/issuing/*`. Bearer `sk_*` auth, form-urlencoded POST bodies, `Stripe-Version` header.

## Auth

- Env: `STRIPE_ISSUING_API_KEY`
- Profile: `connect-stripe-issuing config set-key <key>`
- Config dir: `~/.hasna/connectors/stripe-issuing/`

## Structure

```
src/api/     client + cardholders, cards, authorizations, transactions, events, raw
src/cli/     Commander CLI
src/types/   Issuing types
src/utils/   config, output
```

## Adding Modules

1. Add API class in `src/api/`
2. Wire in `src/api/index.ts`
3. Add types in `src/types/index.ts`
4. Add CLI commands in `src/cli/index.ts`
