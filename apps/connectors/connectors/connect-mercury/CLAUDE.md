# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-mercury is a TypeScript CLI and library for Mercury Banking API. It provides full access to accounts, transactions, transfers, invoices, treasury, and more.

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
├── api/           # API client modules
│   ├── client.ts  # HTTP client with authentication
│   └── index.ts   # Main connector class
├── cli/
│   └── index.ts   # CLI commands
├── types/
│   └── index.ts   # TypeScript types
├── utils/
│   ├── config.ts  # Multi-profile configuration
│   └── output.ts  # CLI output formatting
└── index.ts       # Library exports
```

## New Endpoints (2025-2026)

Mercury has been rapidly expanding their API. Recent additions:
- **Webhooks** — real-time HTTP notifications for account events (transactions, etc.)
- **Internal Transfers** — `POST /transfer` — move money between accounts (requires `SendMoney` write scope)
- **Users API** — `GET /api/v1/users` — retrieve organization users
- **Account Balance Events** — webhooks/events for balance change notifications
- **SAFE API** — 3 new endpoints for reading SAFE (Simple Agreement for Future Equity) data
- **Treasury API statements** — programmatic statement retrieval
- **Attachment uploads** — upload attachments to transactions and recipients

Auth: Basic auth (API token as username, empty password) or Bearer token.
Token tiers: Read-only, Read-write (requires IP whitelist), Custom (scoped).

## Authentication

API Key authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-mercury config set-key <key>`


## CLI Commands

```bash
# Accounts
connect-mercury accounts list
connect-mercury accounts get <accountId>
connect-mercury accounts balance <accountId>
connect-mercury accounts statements <accountId>
connect-mercury accounts cards <accountId>

# Transactions
connect-mercury transactions list <accountId> [-l limit] [-s start] [-e end]
connect-mercury transactions get <accountId> <transactionId>

# Recipients
connect-mercury recipients list
connect-mercury recipients get <recipientId>
connect-mercury recipients create -n <name> -t <type> -m <method>
connect-mercury recipients delete <recipientId>

# Transfers
connect-mercury transfers list <accountId>
connect-mercury transfers send -a <accountId> -r <recipientId> --amount <cents>
connect-mercury transfers internal -f <fromId> -t <toId> --amount <cents>

# Invoices
connect-mercury invoices list
connect-mercury invoices get <invoiceId>
connect-mercury invoices send <invoiceId>
connect-mercury invoices cancel <invoiceId>

# Customers
connect-mercury customers list
connect-mercury customers create -n <name> -e <email>
connect-mercury customers delete <customerId>

# Treasury
connect-mercury treasury list
connect-mercury treasury get <treasuryId>
connect-mercury treasury deposit -t <treasuryId> -f <accountId> --amount <cents>
connect-mercury treasury withdraw -t <treasuryId> --to <accountId> --amount <cents>

# Organization
connect-mercury org info
connect-mercury org users
connect-mercury org me

# Webhooks
connect-mercury webhooks list
connect-mercury webhooks create -u <url> -e <events>
connect-mercury webhooks test <webhookId>
connect-mercury webhooks delete <webhookId>

# Config
connect-mercury config set-key <key>
connect-mercury config show

# Profiles
connect-mercury profile list|use|create|delete|show
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MERCURY_API_KEY` | API key (overrides profile) |

## Data Storage

```
~/.connectors/connect-mercury/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
