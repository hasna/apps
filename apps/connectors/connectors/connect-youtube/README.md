# connect-youtube

YouTube Data API v3 and Analytics API connector CLI - Videos, channels, playlists, comments, live streams, and analytics

## Installation

```bash
bun install -g @hasna/connect-youtube
```

## Quick Start

```bash
# Set your API key
connect-youtube config set-key YOUR_API_KEY

# Or use environment variable
export YOUTUBE_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-youtube config set-key <key>     # Set API key
connect-youtube config show              # Show config
connect-youtube profile list             # List profiles
connect-youtube profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-youtube profile create work --api-key xxx --use
connect-youtube profile create personal --api-key yyy

# Switch profiles
connect-youtube profile use work

# Use profile for single command
connect-youtube -p personal <command>

# List profiles
connect-youtube profile list
```

## Library Usage

```typescript
import { Youtube } from '@hasna/connect-youtube';

const client = new Youtube({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `YOUTUBE_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.connect/connect-youtube/`:

```
~/.connect/connect-youtube/
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
