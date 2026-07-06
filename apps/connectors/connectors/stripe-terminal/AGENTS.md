# AGENTS.md

## Project Overview

connect-stripe-terminal is a TypeScript connector for the Stripe Terminal API (in-person payments, POS hardware).

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## Authentication

Stripe secret API key (Bearer). Set via `STRIPE_TERMINAL_API_KEY` or profile config.

## API Surface

Real Stripe Terminal API at `/v1/terminal/*`:
- connection_tokens, locations, readers, configurations

## Security

- No hardcoded secrets
- Placeholder-only `.env.example`
- No browser-use/playwright dependencies

## Data Storage

`~/.hasna/connectors/stripe-terminal/profiles/`
