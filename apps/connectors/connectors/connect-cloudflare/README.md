# connect-cloudflare

Cloudflare API connector CLI - A TypeScript wrapper for the Cloudflare API with multi-profile support

## Installation

```bash
bun install -g @hasna/connect-cloudflare
```

## Quick Start

```bash
# Set your API key
connect-cloudflare config set-key YOUR_API_KEY

# Or use environment variable
export CLOUDFLARE_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-cloudflare config set-key <key>     # Set API key
connect-cloudflare config show              # Show config
connect-cloudflare profile list             # List profiles
connect-cloudflare profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-cloudflare profile create work --api-key xxx --use
connect-cloudflare profile create personal --api-key yyy

# Switch profiles
connect-cloudflare profile use work

# Use profile for single command
connect-cloudflare -p personal <command>

# List profiles
connect-cloudflare profile list
```

## Library Usage

```typescript
import { Cloudflare } from '@hasna/connect-cloudflare';

const client = new Cloudflare({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CLOUDFLARE_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.connect/connect-cloudflare/`:

```
~/.connect/connect-cloudflare/
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
