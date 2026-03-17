# connect-docsbotai

DocsBot AI API connector

## Installation

```bash
bun install -g @hasna/connect-docsbotai
```

## Quick Start

```bash
# Set your API key
connect-docsbotai config set-key YOUR_API_KEY

# Or use environment variable
export CONNECTOR_API_KEY=YOUR_API_KEY
```

## CLI Commands

### Profile & Config
```bash
connect-docsbotai profile list               # List profiles
connect-docsbotai profile use <name>         # Switch profile
connect-docsbotai profile create <name>      # Create profile
connect-docsbotai config set-key <key>       # Set API key
connect-docsbotai config show                # Show config
connect-docsbotai config clear               # Clear config
```

## Profile Management

```bash
# Create profiles for different accounts
connect-docsbotai profile create work --api-key xxx --use
connect-docsbotai profile create personal --api-key yyy

# Switch profiles
connect-docsbotai profile use work

# Use profile for single command
connect-docsbotai -p personal <command>

# List profiles
connect-docsbotai profile list
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-docsbotai';

const client = new Connector({ apiKey: 'YOUR_API_KEY' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CONNECTOR_API_KEY` | API key (overrides profile) |
| `CONNECTOR_API_SECRET` | API secret (optional) |
| `CONNECTOR_BASE_URL` | Override base URL (optional) |

## Data Storage

Configuration stored in `~/.connect/connect-docsbotai/`:

```
~/.connect/connect-docsbotai/
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

Apache-2.0
