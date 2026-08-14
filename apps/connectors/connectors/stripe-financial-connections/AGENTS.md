# AGENTS.md

Guidance for AI agents working with the Stripe Financial Connections connector.

## Overview

`@hasna/connect-stripe-financial-connections` is a TypeScript API connector for Stripe Financial Connections (banking data / account linking). Uses Bearer token auth against `https://api.stripefinancialconnections.com/v1`.

## Security

- Never commit API keys or secrets
- Use `.env.example` placeholders only
- Config stored in `~/.hasna/connectors/connect-stripe-financial-connections/`

## Commands

```bash
bun install
bun run dev -- --help
bun run typecheck
```
