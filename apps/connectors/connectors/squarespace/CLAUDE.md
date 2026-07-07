# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-squarespace is a TypeScript connector for the Squarespace Commerce API v1.0 with multi-profile configuration support. It provides both a CLI and a programmatic API for managing Products, Orders, Inventory, Transactions, Profiles, Store Pages, Membership, Forms, and Webhooks.

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
- **OrdersApi**: List, get, create, fulfill, refund orders
- **ProductsApi**: CRUD products and variants, assign images
- **TransactionsApi**: List and get financial transactions
- **ProfilesApi**: List, get, create, update customer profiles
- **StorePagesApi**: List and get store pages
- **MembershipApi**: List plans and members
- **FormsApi**: List forms and submissions
- **WebhooksApi**: List, create, delete, rotate webhook secrets

## API Details

- Base URL: `https://api.squarespace.com/1.0`
- Auth header: `Authorization: Bearer {api_key}`
- Pagination: cursor query param on list endpoints

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SQUARESPACE_API_KEY` | Commerce API key |

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
