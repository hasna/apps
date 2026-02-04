# connect-sentry

Sentry API connector - A TypeScript wrapper for Sentry API with multi-profile support

## Installation

```bash
bun install -g @hasna/connect-sentry
```

## Quick Start

```bash
# Set your API key
connect-sentry config set-key YOUR_API_KEY

# Or use environment variable
export SENTRY_AUTH_TOKEN=YOUR_API_KEY
```

## CLI Commands

```bash
connect-sentry config set-key <key>     # Set API key
connect-sentry config show              # Show config
connect-sentry profile list             # List profiles
connect-sentry profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-sentry profile create work --api-key xxx --use
connect-sentry profile create personal --api-key yyy

# Switch profiles
connect-sentry profile use work

# Use profile for single command
connect-sentry -p personal <command>

# List profiles
connect-sentry profile list
```

## Library Usage

```typescript
import { Sentry } from '@hasna/connect-sentry';

const client = new Sentry({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SENTRY_AUTH_TOKEN` | Auth token (preferred, overrides profile) |
| `SENTRY_API_KEY` | API key (legacy, overrides profile) |
| `SENTRY_BASE_URL` | Override base URL (for self-hosted) |

## Data Storage

Configuration stored in `~/.connect/connect-sentry/`:

```
~/.connect/connect-sentry/
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
