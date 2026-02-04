# connect-x

X (Twitter) API v2 connector CLI - Tweets, users, and search

## Installation

```bash
bun install -g @hasna/connect-x
```

## Quick Start

```bash
# Set your API key
connect-x config set-key YOUR_API_KEY

# Or use environment variable
export X_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-x config set-key <key>     # Set API key
connect-x config show              # Show config
connect-x profile list             # List profiles
connect-x profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-x profile create work --api-key xxx --use
connect-x profile create personal --api-key yyy

# Switch profiles
connect-x profile use work

# Use profile for single command
connect-x -p personal <command>

# List profiles
connect-x profile list
```

## Library Usage

```typescript
import { X } from '@hasna/connect-x';

const client = new X({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `X_API_KEY` | API key (Consumer Key) |
| `X_API_SECRET` | API secret (Consumer Secret) |
| `X_BEARER_TOKEN` | Optional pre-generated Bearer token |
| `X_CLIENT_ID` | OAuth 2.0 Client ID |
| `X_CLIENT_SECRET` | OAuth 2.0 Client Secret (optional) |
| `X_ACCESS_TOKEN` | OAuth 2.0 user access token |
| `X_REFRESH_TOKEN` | OAuth 2.0 refresh token |
| `X_OAUTH1_ACCESS_TOKEN` | OAuth 1.0a access token |
| `X_OAUTH1_ACCESS_TOKEN_SECRET` | OAuth 1.0a access token secret |

## Data Storage

Configuration stored in `~/.connect/connect-x/`:

```
~/.connect/connect-x/
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
