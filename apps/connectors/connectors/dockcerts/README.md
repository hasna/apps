# connect-dockcerts

DockCerts API connector

## Installation

```bash
bun install -g @hasna/connect-dockcerts
```

## Quick Start

```bash
# Set your API key
connect-dockcerts config set-key YOUR_API_KEY

# Or use environment variable
export CONNECTOR_API_KEY=YOUR_API_KEY
```

## CLI Commands

### Profile & Config
```bash
connect-dockcerts profile list               # List profiles
connect-dockcerts profile use <name>         # Switch profile
connect-dockcerts profile create <name>      # Create profile
connect-dockcerts config set-key <key>       # Set API key
connect-dockcerts config show                # Show config
connect-dockcerts config clear               # Clear config
```

## Profile Management

```bash
# Create profiles for different accounts
connect-dockcerts profile create work --api-key xxx --use
connect-dockcerts profile create personal --api-key yyy

# Switch profiles
connect-dockcerts profile use work

# Use profile for single command
connect-dockcerts -p personal <command>

# List profiles
connect-dockcerts profile list
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-dockcerts';

const client = new Connector({ apiKey: 'YOUR_API_KEY' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CONNECTOR_API_KEY` | API key (overrides profile) |
| `CONNECTOR_API_SECRET` | API secret (optional) |
| `CONNECTOR_BASE_URL` | Override base URL (optional) |

## Data Storage

Configuration stored in `~/.hasna/connectors/connect-dockcerts/`:

```
~/.hasna/connectors/connect-dockcerts/
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
