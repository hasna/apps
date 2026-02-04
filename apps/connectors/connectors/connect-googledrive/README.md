# connect-googledrive

Google Drive API connector CLI - A TypeScript wrapper for Google Drive with OAuth2 authentication

## Installation

```bash
bun install -g @hasna/connect-googledrive
```

## Quick Start

```bash
# Set your API key
connect-googledrive config set-key YOUR_API_KEY

# Or use environment variable
export GOOGLEDRIVE_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-googledrive config set-key <key>     # Set API key
connect-googledrive config show              # Show config
connect-googledrive profile list             # List profiles
connect-googledrive profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-googledrive profile create work --api-key xxx --use
connect-googledrive profile create personal --api-key yyy

# Switch profiles
connect-googledrive profile use work

# Use profile for single command
connect-googledrive -p personal <command>

# List profiles
connect-googledrive profile list
```

## Library Usage

```typescript
import { Googledrive } from '@hasna/connect-googledrive';

const client = new Googledrive({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLEDRIVE_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.connect/connect-googledrive/`:

```
~/.connect/connect-googledrive/
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
