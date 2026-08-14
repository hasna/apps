# CLAUDE.md

## Project Overview

connect-valence is a TypeScript connector for the Valence prediction markets API with multi-profile configuration support.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer token (`api_key`). Credentials via:
- `VALENCE_API_KEY` environment variable
- Profile: `connect-valence config set-key <key>`

Optional `VALENCE_BASE_URL` or profile `baseUrl` (default `https://api.valence.trade/v1`).

## Data Storage

```
~/.hasna/connectors/connect-valence/
├── current_profile
└── profiles/
    └── default.json
```

## API Endpoints

- `GET /markets` — list markets
- `GET /markets/{marketId}` — get market
- `POST /markets/match-tickers` — match tickers
- `GET /orders` — list orders
- `POST /orders` — create order
- `POST /orders/{orderId}/cancel` — cancel order
- `GET /positions` — portfolio positions
- `GET /balances` — account balances
- `GET /arbitrage/opportunities` — arbitrage opportunities

## Dependencies

- commander, chalk
