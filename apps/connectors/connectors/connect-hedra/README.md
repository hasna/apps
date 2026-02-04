# connect-hedra

Hedra API connector - A TypeScript wrapper for the Hedra AI video generation API with multi-profile support

## Installation

```bash
bun install -g @hasna/connect-hedra
```

## Quick Start

```bash
# Set your API key
connect-hedra config set-key YOUR_API_KEY

# Or use environment variable
export HEDRA_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-hedra config set-key <key>     # Set API key
connect-hedra config show              # Show config
connect-hedra profile list             # List profiles
connect-hedra profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-hedra profile create work --api-key xxx --use
connect-hedra profile create personal --api-key yyy

# Switch profiles
connect-hedra profile use work

# Use profile for single command
connect-hedra -p personal <command>

# List profiles
connect-hedra profile list
```

## Library Usage

```typescript
import { Hedra } from '@hasna/connect-hedra';

const client = new Hedra({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `HEDRA_API_KEY` | API key (overrides profile) |
| `HEDRA_BASE_URL` | Override base URL |

## Data Storage

Configuration stored in `~/.connect/connect-hedra/`:

```
~/.connect/connect-hedra/
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
