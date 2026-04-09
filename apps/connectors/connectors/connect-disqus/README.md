# connect-disqus

Disqus API connector

## Installation

```bash
bun install -g @hasna/connect-disqus
```

## Quick Start

```bash
# Set your API key
connect-disqus config set-key YOUR_API_KEY

# Or use environment variable
export CONNECTOR_API_KEY=YOUR_API_KEY
```

## CLI Commands

### Profile & Config
```bash
connect-disqus profile list               # List profiles
connect-disqus profile use <name>         # Switch profile
connect-disqus profile create <name>      # Create profile
connect-disqus config set-key <key>       # Set API key
connect-disqus config show                # Show config
connect-disqus config clear               # Clear config
```

## Profile Management

```bash
# Create profiles for different accounts
connect-disqus profile create work --api-key xxx --use
connect-disqus profile create personal --api-key yyy

# Switch profiles
connect-disqus profile use work

# Use profile for single command
connect-disqus -p personal <command>

# List profiles
connect-disqus profile list
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-disqus';

const client = new Connector({ apiKey: 'YOUR_API_KEY' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CONNECTOR_API_KEY` | API key (overrides profile) |
| `CONNECTOR_API_SECRET` | API secret (optional) |
| `CONNECTOR_BASE_URL` | Override base URL (optional) |

## Data Storage

Configuration stored in `~/.hasna/connectors/connect-disqus/`:

```
~/.hasna/connectors/connect-disqus/
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
