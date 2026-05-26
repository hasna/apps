# connect-docparser

Docparser API connector

## Installation

```bash
bun install -g @hasna/connect-docparser
```

## Quick Start

```bash
# Set your API key
connect-docparser config set-key YOUR_API_KEY

# Or use environment variable
export CONNECTOR_API_KEY=YOUR_API_KEY
```

## CLI Commands

### Profile & Config
```bash
connect-docparser profile list               # List profiles
connect-docparser profile use <name>         # Switch profile
connect-docparser profile create <name>      # Create profile
connect-docparser config set-key <key>       # Set API key
connect-docparser config show                # Show config
connect-docparser config clear               # Clear config
```

## Profile Management

```bash
# Create profiles for different accounts
connect-docparser profile create work --api-key xxx --use
connect-docparser profile create personal --api-key yyy

# Switch profiles
connect-docparser profile use work

# Use profile for single command
connect-docparser -p personal <command>

# List profiles
connect-docparser profile list
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-docparser';

const client = new Connector({ apiKey: 'YOUR_API_KEY' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CONNECTOR_API_KEY` | API key (overrides profile) |
| `CONNECTOR_API_SECRET` | API secret (optional) |
| `CONNECTOR_BASE_URL` | Override base URL (optional) |

## Data Storage

Configuration stored in `~/.hasna/connectors/connect-docparser/`:

```
~/.hasna/connectors/connect-docparser/
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
