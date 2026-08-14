# connect-diffy

Diffy API connector

## Installation

```bash
bun install -g @hasna/connect-diffy
```

## Quick Start

```bash
# Set your API key
connect-diffy config set-key YOUR_API_KEY

# Or use environment variable
export CONNECTOR_API_KEY=YOUR_API_KEY
```

## CLI Commands

### Profile & Config
```bash
connect-diffy profile list               # List profiles
connect-diffy profile use <name>         # Switch profile
connect-diffy profile create <name>      # Create profile
connect-diffy config set-key <key>       # Set API key
connect-diffy config show                # Show config
connect-diffy config clear               # Clear config
```

## Profile Management

```bash
# Create profiles for different accounts
connect-diffy profile create work --api-key xxx --use
connect-diffy profile create personal --api-key yyy

# Switch profiles
connect-diffy profile use work

# Use profile for single command
connect-diffy -p personal <command>

# List profiles
connect-diffy profile list
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-diffy';

const client = new Connector({ apiKey: 'YOUR_API_KEY' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CONNECTOR_API_KEY` | API key (overrides profile) |
| `CONNECTOR_API_SECRET` | API secret (optional) |
| `CONNECTOR_BASE_URL` | Override base URL (optional) |

## Data Storage

Configuration stored in `~/.hasna/connectors/connect-diffy/`:

```
~/.hasna/connectors/connect-diffy/
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
