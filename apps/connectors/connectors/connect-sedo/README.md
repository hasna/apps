# connect-sedo

Sedo Domain Marketplace API connector CLI - Search, list, and manage domains on Sedo

## Installation

```bash
bun install -g @hasna/connect-sedo
```

## Quick Start

```bash
# Set your API key
connect-sedo config set-key YOUR_API_KEY

# Or use environment variable
export SEDO_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
# Profile Management
connect-sedo profile list
connect-sedo profile use <name>
connect-sedo profile create <name> --set-partner-id <id> --set-api-key <key> --use
connect-sedo profile delete <name>
connect-sedo profile show [name]

# Configuration (applies to active profile)
connect-sedo config set-partner-id <id>
connect-sedo config set-api-key <key>
connect-sedo config set-username <username>
connect-sedo config set-password <password>
connect-sedo config show

# Domain Marketplace
connect-sedo domains search <keyword>
connect-sedo domains search health --tld com --limit 100
connect-sedo domains status domain1.com domain2.com
connect-sedo domains list
connect-sedo domains add example.com --for-sale --price 1000
connect-sedo domains edit example.com --price 2000
connect-sedo domains remove example.com
```

## Profile Management

```bash
# Create profiles for different accounts
connect-sedo profile create work --api-key xxx --use
connect-sedo profile create personal --api-key yyy

# Switch profiles
connect-sedo profile use work

# Use profile for single command
connect-sedo -p personal <command>

# List profiles
connect-sedo profile list
```

## Library Usage

```typescript
import { Sedo } from '@hasna/connect-sedo';

const client = new Sedo({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SEDO_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.connect/connect-sedo/`:

```
~/.connect/connect-sedo/
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
