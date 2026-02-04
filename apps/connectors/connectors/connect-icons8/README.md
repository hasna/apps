# connect-icons8

Icons8 API connector - A TypeScript wrapper for Icons8 API with multi-profile support

## Installation

```bash
bun install -g @hasna/connect-icons8
```

## Quick Start

```bash
# Set your API key
connect-icons8 config set-key YOUR_API_KEY

# Or use environment variable
export ICONS8_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-icons8 config set-key <key>     # Set API key
connect-icons8 config show              # Show config
connect-icons8 profile list             # List profiles
connect-icons8 profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-icons8 profile create work --api-key xxx --use
connect-icons8 profile create personal --api-key yyy

# Switch profiles
connect-icons8 profile use work

# Use profile for single command
connect-icons8 -p personal <command>

# List profiles
connect-icons8 profile list
```

## Library Usage

```typescript
import { Icons8 } from '@hasna/connect-icons8';

const client = new Icons8({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ICONS8_API_KEY` | API key (overrides profile) |
| `ICONS8_BASE_URL` | Override base URL |

## Data Storage

Configuration stored in `~/.connect/connect-icons8/`:

```
~/.connect/connect-icons8/
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
