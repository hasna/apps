# connect-dialzara

Dialzara API connector

## Installation

```bash
bun install -g @hasna/connect-dialzara
```

## Quick Start

```bash
# Set your API key
connect-dialzara config set-key YOUR_API_KEY

# Or use environment variable
export CONNECTOR_API_KEY=YOUR_API_KEY
```

## CLI Commands

### Profile & Config
```bash
connect-dialzara profile list               # List profiles
connect-dialzara profile use <name>         # Switch profile
connect-dialzara profile create <name>      # Create profile
connect-dialzara config set-key <key>       # Set API key
connect-dialzara config show                # Show config
connect-dialzara config clear               # Clear config
```

## Profile Management

```bash
# Create profiles for different accounts
connect-dialzara profile create work --api-key xxx --use
connect-dialzara profile create personal --api-key yyy

# Switch profiles
connect-dialzara profile use work

# Use profile for single command
connect-dialzara -p personal <command>

# List profiles
connect-dialzara profile list
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-dialzara';

const client = new Connector({ apiKey: 'YOUR_API_KEY' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CONNECTOR_API_KEY` | API key (overrides profile) |
| `CONNECTOR_API_SECRET` | API secret (optional) |
| `CONNECTOR_BASE_URL` | Override base URL (optional) |

## Data Storage

Configuration stored in `~/.hasna/connectors/connect-dialzara/`:

```
~/.hasna/connectors/connect-dialzara/
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
