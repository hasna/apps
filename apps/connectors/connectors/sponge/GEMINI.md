# GEMINI.md

This file provides guidance to Gemini when working with this repository.

## Project Overview

connect-sponge is a TypeScript CLI for the public Sponge (PaySponge) Agent
Wallet API. It provides multi-profile configuration, Bearer API-key
authentication, and a Commander.js CLI over agents, wallets, transfers,
swaps/bridges, fiat onramps, cards, and x402/MPP paid requests.

## Build & Run Commands

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build for distribution
bun run build

# Type check
bun run typecheck

# Run unit tests
bun test
```

## Code Style

- TypeScript with strict mode
- ESM modules (`type: module`)
- Async/await for all async operations
- Minimal dependencies: commander, chalk
- Type annotations required everywhere

## Project Structure

```
src/
├── api/            # API client + resource modules
│   ├── client.ts   # Fetch client with Bearer auth + Sponge-Version header
│   ├── agents.ts   # Agents
│   ├── wallets.ts  # Wallets & balances
│   ├── transfers.ts# Transfers, tokens, swaps, bridges, transactions
│   ├── payments.ts # x402 + MPP paid requests
│   ├── trading.ts  # Hyperliquid
│   ├── onramp.ts   # Coinbase / Stripe / crypto fiat onramps
│   ├── cards.ts    # Cards + Sponge Card lifecycle
│   ├── keys.ts     # Agent service keys (secrets)
│   ├── raw.ts      # Raw request escape hatch
│   └── index.ts    # Sponge facade class
├── cli/
│   └── index.ts    # CLI commands
├── types/
│   └── index.ts    # TypeScript types
├── utils/
│   ├── config.ts   # Multi-profile configuration
│   └── output.ts   # CLI output formatting
└── index.ts        # Library exports
```

## API

- Base URL: `https://api.wallet.paysponge.com` (override with `SPONGE_BASE_URL`).
- Auth: `Authorization: Bearer <SPONGE_API_KEY>`.
- Optional `Sponge-Version` header via `SPONGE_VERSION`.
- Public reference: https://docs.paysponge.com and its OpenAPI spec at
  https://docs.paysponge.com/api-reference/public-openapi.json.

All request/response bodies are JSON. Never commit real API keys — `.env.example`
carries placeholders only.
