# GEMINI.md

This file provides guidance to Gemini when working with this repository.

## Project Overview

connect-revolut is a TypeScript connector for Revolut Business API with multi-profile configuration support. It provides access to Accounts, Counterparties, Payments, Transactions, Exchange, and Cards APIs.

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

## Authentication

Bearer Token authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-revolut config set-key <key>`


## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/connect-revolut/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### Authentication

Uses Bearer token authentication for all requests. Token can be set via:
- Environment variable: `REVOLUT_API_TOKEN`
- Profile configuration: `connect-revolut config set-token <token>`

### Service APIs

Each Revolut service has its own API module:
- **AccountsApi**: List accounts, get account details, get balances
- **CounterpartiesApi**: List/create/delete counterparties
- **PaymentsApi**: Create payments/transfers, get payment info
- **TransactionsApi**: List/get transactions
- **ExchangeApi**: Get rates, exchange currency
- **CardsApi**: List/create/manage virtual cards

## CLI Commands

### Accounts
```bash
connect-revolut accounts list           # List all accounts
connect-revolut accounts get <id>       # Get account details
connect-revolut balance                 # Show all balances
```

### Counterparties
```bash
connect-revolut counterparties list     # List counterparties
connect-revolut counterparties get <id> # Get counterparty details
connect-revolut counterparties create --name "John" --type personal
connect-revolut counterparties delete <id>
```

### Payments
```bash
connect-revolut payments create <accountId> <counterpartyId> <amount> <currency>
connect-revolut payments get <id>
connect-revolut payments cancel <id>
connect-revolut payments transfer <sourceId> <targetId> <amount> <currency>
```

### Transactions
```bash
connect-revolut transactions list
connect-revolut transactions list --from 2024-01-01 --to 2024-12-31
connect-revolut transactions get <id>
```

### Exchange
```bash
connect-revolut exchange rate EUR USD
connect-revolut exchange rate EUR USD --amount 1000
connect-revolut exchange convert <fromAcct> <toAcct> <amount> --from-currency EUR --to-currency USD
```

### Cards
```bash
connect-revolut cards list
connect-revolut cards get <id>
connect-revolut cards create --label "Marketing Card"
connect-revolut cards freeze <id>
connect-revolut cards unfreeze <id>
connect-revolut cards terminate <id>
```

### Profile & Config
```bash
connect-revolut profile list               # List profiles
connect-revolut profile use <name>         # Switch profile
connect-revolut profile create <name>      # Create profile
connect-revolut config set-token <token>   # Set API token
connect-revolut config set-sandbox true    # Enable sandbox
connect-revolut config show
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `REVOLUT_API_TOKEN` | Revolut API token (overrides profile) |
| `REVOLUT_SANDBOX` | Set to "true" to use sandbox environment |

## Data Storage

```
~/.connect/connect-revolut/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
