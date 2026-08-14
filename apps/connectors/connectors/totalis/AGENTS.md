# AGENTS.md

Guidance for AI agents working with the Totalis connector.

## Overview

`@hasna/connect-totalis` wraps the Totalis REST API for prediction-market parlays.

## Quick Commands

```bash
bun install
bun run dev
bun run typecheck
bun test
```

## Authentication

- Type: API key (`X-API-Key` header)
- Env: `TOTALIS_API_KEY`
- Config: `connect-totalis config set-key <key>`
- Storage: `~/.hasna/connectors/connect-totalis/`

## API Modules

- `markets` — public market listings
- `parlays` — `/v1/rfqs` history
- `quoteRequests` — live quote request create/get/update/cancel/commit
- `wallet` — `/v1/wallet` balances

## Security

- No hardcoded secrets
- `.env.example` uses placeholders only
- No browser-use dependency
