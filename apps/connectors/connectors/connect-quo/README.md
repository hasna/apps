# connect-quo

Quo (OpenPhone) API connector - A TypeScript CLI for the Quo messaging and calling API

## Installation

```bash
bun install -g @hasna/connect-quo
```

## Quick Start

```bash
# Set your API key
connect-quo config set-key YOUR_API_KEY

# Or use environment variable
export QUO_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-quo config set-key <key>     # Set API key
connect-quo config show              # Show config
connect-quo profile list             # List profiles
connect-quo profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-quo profile create work --api-key xxx --use
connect-quo profile create personal --api-key yyy

# Switch profiles
connect-quo profile use work

# Use profile for single command
connect-quo -p personal <command>

# List profiles
connect-quo profile list
```

## Library Usage

```typescript
import { Quo } from '@hasna/connect-quo';

const client = new Quo({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `QUO_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.connect/connect-quo/`:

```
~/.connect/connect-quo/
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
