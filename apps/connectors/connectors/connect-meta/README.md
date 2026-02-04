# connect-meta

Meta Marketing API connector CLI - Facebook/Instagram ads, campaigns, audiences, and insights

## Installation

```bash
bun install -g @hasna/connect-meta
```

## Quick Start

```bash
# Set your API key
connect-meta config set-key YOUR_API_KEY

# Or use environment variable
export META_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-meta config set-key <key>     # Set API key
connect-meta config show              # Show config
connect-meta profile list             # List profiles
connect-meta profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-meta profile create work --api-key xxx --use
connect-meta profile create personal --api-key yyy

# Switch profiles
connect-meta profile use work

# Use profile for single command
connect-meta -p personal <command>

# List profiles
connect-meta profile list
```

## Library Usage

```typescript
import { Meta } from '@hasna/connect-meta';

const client = new Meta({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `META_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.connect/connect-meta/`:

```
~/.connect/connect-meta/
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
