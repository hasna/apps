# CLAUDE.md

## Project Overview

connect-triple-whale is a TypeScript connector for the [Triple Whale](https://www.triplewhale.com/) ecommerce analytics platform. It provides CLI and programmatic access to summary metrics, attribution, data-in ingestion, SQL queries, Moby AI, Triple Pixel events, and compliance APIs.

Base URL: `https://api.triplewhale.com` (paths are prefixed to `/api/v2` automatically).

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## Authentication

API Key authentication via `x-api-key` header.

Credentials can be set via:
- Environment variables (see below)
- Profile configuration: `connect-triple-whale config set-key <key>`

Many POST operations require a shop domain — set via `TRIPLE_WHALE_SHOP_DOMAIN` or `connect-triple-whale config set-shop <domain>`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TRIPLE_WHALE_API_KEY` | Triple Whale API key (overrides profile) |
| `TRIPLE_WHALE_SHOP_DOMAIN` | Default shop domain for shop-scoped operations |
| `TRIPLE_WHALE_BASE_URL` | Override API base URL (default: https://api.triplewhale.com) |

## Data Storage

```
~/.hasna/connectors/connect-triple-whale/
├── current_profile
└── profiles/
    ├── default.json
    └── {name}.json
```

Profile JSON:
```json
{
  "apiKey": "your-api-key",
  "shopDomain": "your-shop.myshopify.com",
  "baseUrl": "https://api.triplewhale.com"
}
```

## CLI Operations

```bash
connect-triple-whale validate-api-key
connect-triple-whale get-summary --shop-domain shop.myshopify.com --start-date 2026-01-01 --end-date 2026-01-31
connect-triple-whale export-attributed-orders --shop shop.myshopify.com --start-date 2026-01-01 --end-date 2026-01-31
connect-triple-whale run-sql-query --shop shop.myshopify.com --query "SELECT 1"
connect-triple-whale ask-moby --shop shop.myshopify.com --question "What was ROAS last week?"
connect-triple-whale create-order-record --shop shop.myshopify.com --body '{"order":{...}}'
connect-triple-whale raw-request --path /users/api-keys/me
```

Use `--body '{"key":"value"}'` to pass full JSON payloads; flag values are merged into the body.

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
