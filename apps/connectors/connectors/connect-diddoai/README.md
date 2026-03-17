# connect-diddoai

Diddo AI API connector

## Installation

```bash
bun install -g @hasna/connect-diddoai
```

## Quick Start

```bash
# Set your API key
connect-diddoai config set-key YOUR_API_KEY

# Or use environment variable
export CONNECTOR_API_KEY=YOUR_API_KEY
```

## CLI Commands

### Profile & Config
```bash
connect-diddoai profile list               # List profiles
connect-diddoai profile use <name>         # Switch profile
connect-diddoai profile create <name>      # Create profile
connect-diddoai config set-key <key>       # Set API key
connect-diddoai config show                # Show config
connect-diddoai config clear               # Clear config
```

## Profile Management

```bash
# Create profiles for different accounts
connect-diddoai profile create work --api-key xxx --use
connect-diddoai profile create personal --api-key yyy

# Switch profiles
connect-diddoai profile use work

# Use profile for single command
connect-diddoai -p personal <command>

# List profiles
connect-diddoai profile list
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-diddoai';

const client = new Connector({ apiKey: 'YOUR_API_KEY' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CONNECTOR_API_KEY` | API key (overrides profile) |
| `CONNECTOR_API_SECRET` | API secret (optional) |
| `CONNECTOR_BASE_URL` | Override base URL (optional) |

## Data Storage

Configuration stored in `~/.connect/connect-diddoai/`:

```
~/.connect/connect-diddoai/
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
