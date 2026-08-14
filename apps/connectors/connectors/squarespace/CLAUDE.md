# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-squarespace is a TypeScript connector for Squarespace Commerce APIs with multi-profile configuration support. It provides both a CLI and a programmatic API for managing Products, Orders, Inventory, Transactions, Profiles, Store Pages, and Webhooks.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

API Key authentication. Credentials can be set via:
- Environment variable: `SQUARESPACE_API_KEY`
- Profile configuration: `connect-squarespace config set-key <key>`

## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.hasna/connectors/connect-squarespace/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### Service APIs

- **InventoryApi**: List, get by variant IDs, adjust stock
- **OrdersApi**: List, get, create, and fulfill orders. Create order requires an idempotency key.
- **ProductsApi**: Products API v2 CRUD, variants, and variant image association
- **TransactionsApi**: List and get financial transactions
- **ProfilesApi**: List and get customer profiles
- **StorePagesApi**: List store pages
- **WebhooksApi**: List, create, delete, rotate webhook secrets. Webhook subscription operations require a Squarespace OAuth access token with webhook scopes.

## API Details

- Base URL: `https://api.squarespace.com/1.0` for most Commerce APIs
- Products API base: `https://api.squarespace.com/v2/commerce/products`
- Auth header: `Authorization: Bearer <token>`
- Pagination: cursor query param on list endpoints

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SQUARESPACE_API_KEY` | Commerce API key or OAuth access token |

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
