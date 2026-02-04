# connect-revolut

Revolut Business API connector CLI - Accounts, Payments, Counterparties, Transactions, Exchange, Cards with multi-profile support

## Installation

```bash
bun install -g @hasna/connect-revolut
```

## Quick Start

```bash
# Set your API key
connect-revolut config set-key YOUR_API_KEY

# Or use environment variable
export REVOLUT_API_TOKEN=YOUR_API_KEY
```

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

## Profile Management

```bash
# Create profiles for different accounts
connect-revolut profile create work --api-key xxx --use
connect-revolut profile create personal --api-key yyy

# Switch profiles
connect-revolut profile use work

# Use profile for single command
connect-revolut -p personal <command>

# List profiles
connect-revolut profile list
```

## Library Usage

```typescript
import { Revolut } from '@hasna/connect-revolut';

const client = new Revolut({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `REVOLUT_API_TOKEN` | Revolut API token (overrides profile) |
| `REVOLUT_SANDBOX` | Set to "true" to use sandbox environment |

## Data Storage

Configuration stored in `~/.connect/connect-revolut/`:

```
~/.connect/connect-revolut/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Development

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build
bun run build

# Type check
bun run typecheck
```

## License

MIT
