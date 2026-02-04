# connect-maropost

Maropost API connector - TypeScript SDK and CLI for Maropost marketing automation platform

## Installation

```bash
bun install -g @hasna/connect-maropost
```

## Quick Start

```bash
# Set your API key
connect-maropost config set-key YOUR_API_KEY

# Or use environment variable
export MAROPOST_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-maropost config set-key <key>     # Set API key
connect-maropost config show              # Show config
connect-maropost profile list             # List profiles
connect-maropost profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-maropost profile create work --api-key xxx --use
connect-maropost profile create personal --api-key yyy

# Switch profiles
connect-maropost profile use work

# Use profile for single command
connect-maropost -p personal <command>

# List profiles
connect-maropost profile list
```

## Library Usage

```typescript
import { Maropost } from '@hasna/connect-maropost';

const client = new Maropost({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MAROPOST_API_KEY` | API key (overrides profile) |
| `MAROPOST_ACCOUNT_ID` | Account ID (overrides profile) |
| `MAROPOST_BASE_URL` | Override base URL |

## Data Storage

Configuration stored in `~/.connect/connect-maropost/`:

```
~/.connect/connect-maropost/
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
