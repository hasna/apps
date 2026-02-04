# connect-brandsight

Brandsight/GoDaddy Domain API connector CLI - A TypeScript wrapper for domain management

## Installation

```bash
bun install -g @hasna/connect-brandsight
```

## Quick Start

```bash
# Set your API key
connect-brandsight config set-key YOUR_API_KEY

# Or use environment variable
export BRANDSIGHT_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
# Profile Management
connect-brandsight profile list
connect-brandsight profile use <name>
connect-brandsight profile create <name> --set-api-key <key> --set-api-secret <secret> --set-customer-id <id> --use
connect-brandsight profile delete <name>
connect-brandsight profile show [name]

# Configuration (applies to active profile)
connect-brandsight config set-key <api-key>
connect-brandsight config set-secret <api-secret>
connect-brandsight config set-customer-id <customer-id>
connect-brandsight config show

# Contact Management (stored in ~/.connect/connect-brandsight/contacts/)
connect-brandsight contacts add <name> \
  --first-name "John" --last-name "Doe" \
  --email "john@example.com" --phone "+1.5551234567" \
  --address "123 Main St" --city "San Francisco" \
  --state "CA" --postal-code "94102" --country "US" \
  --default
connect-brandsight contacts list
connect-brandsight contacts show <name>
connect-brandsight contacts remove <name>
connect-brandsight contacts set-default <name>

# Domain Operations
connect-brandsight domains check <domain>
connect-brandsight domains check-bulk domain1.com domain2.com domain3.com
connect-brandsight domains suggest <keyword>
connect-brandsight domains list
connect-brandsight domains info <domain>
connect-brandsight domains tlds
connect-brandsight domains purchase <domain> --contact <name>  # Use saved contact
connect-brandsight domains purchase <domain>                    # Uses default contact
connect-brandsight domains purchase <domain> --contact-json contact.json  # Use JSON file

# DNS Operations
connect-brandsight dns list <domain>
connect-brandsight dns add <domain> <type> <name> <data>
```

## Profile Management

```bash
# Create profiles for different accounts
connect-brandsight profile create work --api-key xxx --use
connect-brandsight profile create personal --api-key yyy

# Switch profiles
connect-brandsight profile use work

# Use profile for single command
connect-brandsight -p personal <command>

# List profiles
connect-brandsight profile list
```

## Library Usage

```typescript
import { Brandsight } from '@hasna/connect-brandsight';

const client = new Brandsight({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `BRANDSIGHT_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.connect/connect-brandsight/`:

```
~/.connect/connect-brandsight/
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
