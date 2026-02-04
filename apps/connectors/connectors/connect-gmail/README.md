# connect-gmail

Gmail API connector CLI - A TypeScript wrapper for Gmail with OAuth2 authentication

## Installation

```bash
bun install -g @hasna/connect-gmail
```

## Quick Start

```bash
# Set your API key
connect-gmail config set-key YOUR_API_KEY

# Or use environment variable
export GMAIL_CLIENT_ID=YOUR_API_KEY
```

## CLI Commands

```bash
connect-gmail config set-key <key>     # Set API key
connect-gmail config show              # Show config
connect-gmail profile list             # List profiles
connect-gmail profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-gmail profile create work --api-key xxx --use
connect-gmail profile create personal --api-key yyy

# Switch profiles
connect-gmail profile use work

# Use profile for single command
connect-gmail -p personal <command>

# List profiles
connect-gmail profile list
```

## Library Usage

```typescript
import { Gmail } from '@hasna/connect-gmail';

const client = new Gmail({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GMAIL_CLIENT_ID` | OAuth2 client ID |
| `GMAIL_CLIENT_SECRET` | OAuth2 client secret |
| `GMAIL_ACCESS_TOKEN` | Override access token |
| `GMAIL_REFRESH_TOKEN` | Override refresh token |

## Data Storage

Configuration stored in `~/.connect/connect-gmail/`:

```
~/.connect/connect-gmail/
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
