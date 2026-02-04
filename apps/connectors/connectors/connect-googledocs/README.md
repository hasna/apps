# connect-googledocs

Google Docs API v1 connector - Create, read, and edit Google Docs programmatically

## Installation

```bash
bun install -g @hasna/connect-googledocs
```

## Quick Start

```bash
# Set your API key
connect-googledocs config set-key YOUR_API_KEY

# Or use environment variable
export GOOGLE_ACCESS_TOKEN=YOUR_API_KEY
```

## CLI Commands

```bash
# Document operations
connect-googledocs get <documentId>           # Get document content
connect-googledocs create <title>             # Create new document
connect-googledocs append <documentId> <text> # Append text
connect-googledocs replace <documentId> <find> <replace>  # Find/replace
connect-googledocs insert <documentId> <text> <index>     # Insert at position
connect-googledocs delete-range <documentId> <start> <end> # Delete range
connect-googledocs insert-image <documentId> <uri> <index> # Insert image

# Configuration
connect-googledocs config set-token <token>   # Set OAuth token
connect-googledocs config set-key <key>       # Set API key
connect-googledocs config show                # Show config
connect-googledocs config clear               # Clear config

# Profiles
connect-googledocs profile list               # List profiles
connect-googledocs profile use <name>         # Switch profile
connect-googledocs profile create <name>      # Create profile
connect-googledocs profile delete <name>      # Delete profile
connect-googledocs profile show [name]        # Show profile config
```

## Profile Management

```bash
# Create profiles for different accounts
connect-googledocs profile create work --api-key xxx --use
connect-googledocs profile create personal --api-key yyy

# Switch profiles
connect-googledocs profile use work

# Use profile for single command
connect-googledocs -p personal <command>

# List profiles
connect-googledocs profile list
```

## Library Usage

```typescript
import { Googledocs } from '@hasna/connect-googledocs';

const client = new Googledocs({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_ACCESS_TOKEN` | OAuth2 access token (full access) |
| `GOOGLE_API_KEY` | API key (read-only) |

## Data Storage

Configuration stored in `~/.connect/connect-googledocs/`:

```
~/.connect/connect-googledocs/
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
