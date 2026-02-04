# connect-stripeatlas

Stripe Atlas connector - Browser automation for Stripe Atlas dashboard (no public API)

## Installation

```bash
bun install -g @hasna/connect-stripeatlas
```

## Quick Start

```bash
# Set your API key
connect-stripeatlas config set-key YOUR_API_KEY

# Or use environment variable
export STRIPE_ATLAS_EMAIL=YOUR_API_KEY
```

## CLI Commands

```bash
connect-stripeatlas config set-key <key>     # Set API key
connect-stripeatlas config show              # Show config
connect-stripeatlas profile list             # List profiles
connect-stripeatlas profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-stripeatlas profile create work --api-key xxx --use
connect-stripeatlas profile create personal --api-key yyy

# Switch profiles
connect-stripeatlas profile use work

# Use profile for single command
connect-stripeatlas -p personal <command>

# List profiles
connect-stripeatlas profile list
```

## Library Usage

```typescript
import { Stripeatlas } from '@hasna/connect-stripeatlas';

const client = new Stripeatlas({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STRIPE_ATLAS_EMAIL` | Stripe Atlas account email |
| `STRIPE_ATLAS_PASSWORD` | Stripe Atlas account password |

## Data Storage

Configuration stored in `~/.connect/connect-stripeatlas/`:

```
~/.connect/connect-stripeatlas/
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
