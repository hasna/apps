# CLAUDE.md

This file provides guidance to Claude Code when working with the ZeroSettle connector.

## Project Overview

connect-zerosettle is a TypeScript connector for the [ZeroSettle IAP API](https://docs.zerosettle.io/api-reference/introduction). It provides multi-profile configuration, publishable-key authentication, and CLI access to products, payment intents, checkout sessions, transactions, entitlements, restore, subscriptions, and events.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

API key authentication via the `X-ZeroSettle-Key` header using your ZeroSettle publishable key. Credentials can be set via:

- Environment variable: `ZEROSETTLE_PUBLISHABLE_KEY`
- Profile configuration: `connect-zerosettle config set-key <key>`
- CLI flag: `--publishable-key <key>`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZEROSETTLE_PUBLISHABLE_KEY` | Publishable API key (overrides profile) |
| `ZEROSETTLE_BASE_URL` | Override API base URL (default `https://api.zerosettle.io`) |

## Data Storage

```
~/.hasna/connectors/connect-zerosettle/
├── current_profile
└── profiles/
    ├── default.json
    └── {name}.json
```

Profile JSON structure:

```json
{
  "publishableKey": "zs_pk_...",
  "baseUrl": "https://api.zerosettle.io"
}
```

## CLI Commands

```bash
connect-zerosettle products list [--user-id <id>]
connect-zerosettle payment-intent create --product-id <id> --user-id <id>
connect-zerosettle checkout-session create --product-id <id> --user-id <id>
connect-zerosettle transaction get <transactionId>
connect-zerosettle entitlements list [--user-id <id>]
connect-zerosettle restore run --user-id <id>
connect-zerosettle subscription cancel <subscriptionId> [--reason <reason>]
connect-zerosettle event track --event <name> --user-id <id>
connect-zerosettle raw-request --path /v1/iap/products/ [--method GET] [--query '{}'] [--body '{}']
```

## Project Structure

```
src/
├── api/
│   ├── client.ts   # HTTP client (X-ZeroSettle-Key auth)
│   ├── iap.ts      # IAP endpoint methods
│   └── index.ts    # ZeroSettle connector class
├── cli/index.ts
├── types/index.ts
├── utils/config.ts
└── utils/output.ts
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
