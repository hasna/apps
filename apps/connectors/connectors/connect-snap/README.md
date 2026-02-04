# connect-snap

Snapchat Marketing API connector CLI - Organizations, ad accounts, campaigns, ads, creatives, audiences, and analytics

## Installation

```bash
bun install -g @hasna/connect-snap
```

## Quick Start

```bash
# Set your API key
connect-snap config set-key YOUR_API_KEY

# Or use environment variable
export SNAP_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-snap config set-key <key>     # Set API key
connect-snap config show              # Show config
connect-snap profile list             # List profiles
connect-snap profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-snap profile create work --api-key xxx --use
connect-snap profile create personal --api-key yyy

# Switch profiles
connect-snap profile use work

# Use profile for single command
connect-snap -p personal <command>

# List profiles
connect-snap profile list
```

## Library Usage

```typescript
import { Snap } from '@hasna/connect-snap';

const client = new Snap({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SNAP_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.connect/connect-snap/`:

```
~/.connect/connect-snap/
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
