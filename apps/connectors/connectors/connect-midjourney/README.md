# connect-midjourney

Midjourney API connector - A TypeScript wrapper for Midjourney image generation via Discord bot or third-party API

## Installation

```bash
bun install -g @hasna/connect-midjourney
```

## Quick Start

```bash
# Set your API key
connect-midjourney config set-key YOUR_API_KEY

# Or use environment variable
export MIDJOURNEY_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-midjourney config set-key <key>     # Set API key
connect-midjourney config show              # Show config
connect-midjourney profile list             # List profiles
connect-midjourney profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-midjourney profile create work --api-key xxx --use
connect-midjourney profile create personal --api-key yyy

# Switch profiles
connect-midjourney profile use work

# Use profile for single command
connect-midjourney -p personal <command>

# List profiles
connect-midjourney profile list
```

## Library Usage

```typescript
import { Midjourney } from '@hasna/connect-midjourney';

const client = new Midjourney({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MIDJOURNEY_API_KEY` | API key for third-party service |
| `DISCORD_TOKEN` | Discord bot token (optional) |
| `MIDJOURNEY_BASE_URL` | Override base URL |

## Data Storage

Configuration stored in `~/.connect/connect-midjourney/`:

```
~/.connect/connect-midjourney/
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
