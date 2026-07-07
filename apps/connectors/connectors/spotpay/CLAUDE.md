# CLAUDE.md

## Project Overview

connect-spotpay is a TypeScript connector for the SpotPay API with multi-profile configuration support. It provides access to accounts, transactions, transfers, payments, cards, and exchange rates.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts
```

## Authentication

Bearer token authentication. Credentials via `SPOTPAY_API_KEY` or `connect-spotpay config set-key <key>`.

Profiles stored in `~/.hasna/connectors/connect-spotpay/profiles/`.

## API Endpoints

- `GET /account`
- `GET /transactions`
- `POST /transfers`
- `POST /payments`
- `GET /cards`
- `GET /exchange-rates`

Default base URL: `https://api.spotpay.com/v1`

## Dependencies

- commander
- chalk
