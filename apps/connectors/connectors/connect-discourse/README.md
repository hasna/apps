# connect-discourse

Discourse API connector

## Installation

```bash
bun install -g @hasna/connect-discourse
```

## Quick Start

```bash
# Set your API key
connect-discourse config set-key YOUR_API_KEY

# Or use environment variable
export CONNECTOR_API_KEY=YOUR_API_KEY
```

## CLI Commands

### Profile & Config
```bash
connect-discourse profile list               # List profiles
connect-discourse profile use <name>         # Switch profile
connect-discourse profile create <name>      # Create profile
connect-discourse config set-key <key>       # Set API key
connect-discourse config show                # Show config
connect-discourse config clear               # Clear config
```

## Profile Management

```bash
# Create profiles for different accounts
connect-discourse profile create work --api-key xxx --use
connect-discourse profile create personal --api-key yyy

# Switch profiles
connect-discourse profile use work

# Use profile for single command
connect-discourse -p personal <command>

# List profiles
connect-discourse profile list
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-discourse';

const client = new Connector({ apiKey: 'YOUR_API_KEY' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CONNECTOR_API_KEY` | API key (overrides profile) |
| `CONNECTOR_API_SECRET` | API secret (optional) |
| `CONNECTOR_BASE_URL` | Override base URL (optional) |

## Data Storage

Configuration stored in `~/.connect/connect-discourse/`:

```
~/.connect/connect-discourse/
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
