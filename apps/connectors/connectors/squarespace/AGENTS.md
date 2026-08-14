# AGENTS.md

Guidance for AI agents working with connect-squarespace.

## Overview

TypeScript connector for Squarespace Commerce APIs. Bearer token auth. Uses direct HTTP requests only.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Structure

```
src/
|-- api/           # REST client + resource modules
|-- cli/           # Commander CLI
|-- types/         # TypeScript types
|-- utils/         # config.ts, output.ts
`-- index.ts
```

## Auth

- Type: API key or OAuth access token (Bearer)
- Env: `SQUARESPACE_API_KEY`
- Config: `~/.hasna/connectors/connect-squarespace/`

Webhook subscription commands require a Squarespace OAuth access token with webhook scopes.

## API Base

- Most APIs: `https://api.squarespace.com/1.0`
- Products API: `https://api.squarespace.com/v2/commerce/products`
- Inventory adjustment and order creation require an idempotency key.
