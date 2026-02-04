# connect-mercury

Mercury Banking API connector CLI - Accounts, transactions, transfers, invoices, and treasury management

## Installation

```bash
bun install -g @hasna/connect-mercury
```

## Quick Start

```bash
# Set your API key
connect-mercury config set-key YOUR_API_KEY

# Or use environment variable
export MERCURY_API_KEY=YOUR_API_KEY
```

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

## Profile Management

```bash
# Create profiles for different accounts
connect-mercury profile create work --api-key xxx --use
connect-mercury profile create personal --api-key yyy

# Switch profiles
connect-mercury profile use work

# Use profile for single command
connect-mercury -p personal <command>

# List profiles
connect-mercury profile list
```

## Library Usage

```typescript
import { Mercury } from '@hasna/connect-mercury';

const client = new Mercury({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MERCURY_API_KEY` | API key (overrides profile) |

## Data Storage

Configuration stored in `~/.connect/connect-mercury/`:

```
~/.connect/connect-mercury/
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
