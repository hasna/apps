# AGENTS.md

## Project Overview

connect-spotpay is a TypeScript connector for the SpotPay stablecoin neobank API with multi-profile configuration.

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test src/api/client.test.ts
```

## Authentication

Bearer token via `SPOTPAY_API_KEY` or profile at `~/.hasna/connectors/connect-spotpay/`.

## Structure

```
src/
├── api/       # HTTP client and SpotPay facade
├── cli/       # Commander CLI
├── types/     # TypeScript types
├── utils/     # config + output
└── index.ts   # Library exports
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SPOTPAY_API_KEY` | API key |
| `SPOTPAY_BASE_URL` | Optional base URL override |
