# connect-heygen

HeyGen API connector - TypeScript wrapper and CLI for HeyGen AI video generation API

## Installation

```bash
bun install -g @hasna/connect-heygen
```

## Quick Start

```bash
# Set your API key
connect-heygen config set-key YOUR_API_KEY

# Or use environment variable
export HEYGEN_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-heygen config set-key <key>     # Set API key
connect-heygen config show              # Show config
connect-heygen profile list             # List profiles
connect-heygen profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-heygen profile create work --api-key xxx --use
connect-heygen profile create personal --api-key yyy

# Switch profiles
connect-heygen profile use work

# Use profile for single command
connect-heygen -p personal <command>

# List profiles
connect-heygen profile list
```

## Library Usage

```typescript
import { Heygen } from '@hasna/connect-heygen';

const client = new Heygen({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `HEYGEN_API_KEY` | API key (overrides profile) |
| `HEYGEN_API_SECRET` | API secret (optional) |
| `HEYGEN_BASE_URL` | Override base URL |

## Data Storage

Configuration stored in `~/.connect/connect-heygen/`:

```
~/.connect/connect-heygen/
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
