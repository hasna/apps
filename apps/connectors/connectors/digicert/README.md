# connect-digicert

DigiCert API connector

## Installation

```bash
bun install -g @hasna/connect-digicert
```

## Quick Start

```bash
# Set your API key
connect-digicert config set-key YOUR_API_KEY

# Or use environment variable
export CONNECTOR_API_KEY=YOUR_API_KEY
```

## CLI Commands

### Profile & Config
```bash
connect-digicert profile list               # List profiles
connect-digicert profile use <name>         # Switch profile
connect-digicert profile create <name>      # Create profile
connect-digicert config set-key <key>       # Set API key
connect-digicert config show                # Show config
connect-digicert config clear               # Clear config
```

## Profile Management

```bash
# Create profiles for different accounts
connect-digicert profile create work --api-key xxx --use
connect-digicert profile create personal --api-key yyy

# Switch profiles
connect-digicert profile use work

# Use profile for single command
connect-digicert -p personal <command>

# List profiles
connect-digicert profile list
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-digicert';

const client = new Connector({ apiKey: 'YOUR_API_KEY' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CONNECTOR_API_KEY` | API key (overrides profile) |
| `CONNECTOR_API_SECRET` | API secret (optional) |
| `CONNECTOR_BASE_URL` | Override base URL (optional) |

## Data Storage

Configuration stored in `~/.hasna/connectors/connect-digicert/`:

```
~/.hasna/connectors/connect-digicert/
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
