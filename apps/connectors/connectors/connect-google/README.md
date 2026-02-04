# connect-google

Google Workspace API connector CLI - Gmail, Drive, Calendar, Docs, Sheets

## Installation

```bash
bun install -g @hasna/connect-google
```

## Quick Start

```bash
# Set your API key
connect-google config set-key YOUR_API_KEY

# Or use environment variable
export GOOGLE_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-google config set-key <key>     # Set API key
connect-google config show              # Show config
connect-google profile list             # List profiles
connect-google profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-google profile create work --api-key xxx --use
connect-google profile create personal --api-key yyy

# Switch profiles
connect-google profile use work

# Use profile for single command
connect-google -p personal <command>

# List profiles
connect-google profile list
```

## Library Usage

```typescript
import { Google } from '@hasna/connect-google';

const client = new Google({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.connect/connect-google/`:

```
~/.connect/connect-google/
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
