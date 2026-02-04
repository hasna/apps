# connect-tiktok

TikTok Marketing API connector CLI - Campaigns, ads, audiences, creatives, and analytics

## Installation

```bash
bun install -g @hasna/connect-tiktok
```

## Quick Start

```bash
# Set your API key
connect-tiktok config set-key YOUR_API_KEY

# Or use environment variable
export TIKTOK_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-tiktok config set-key <key>     # Set API key
connect-tiktok config show              # Show config
connect-tiktok profile list             # List profiles
connect-tiktok profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-tiktok profile create work --api-key xxx --use
connect-tiktok profile create personal --api-key yyy

# Switch profiles
connect-tiktok profile use work

# Use profile for single command
connect-tiktok -p personal <command>

# List profiles
connect-tiktok profile list
```

## Library Usage

```typescript
import { Tiktok } from '@hasna/connect-tiktok';

const client = new Tiktok({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TIKTOK_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.connect/connect-tiktok/`:

```
~/.connect/connect-tiktok/
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
