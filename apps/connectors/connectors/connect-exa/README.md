# connect-exa

Exa AI Search API connector CLI - Web search, content retrieval, similar pages, answers, research tasks, and websets

## Installation

```bash
bun install -g @hasna/connect-exa
```

## Quick Start

```bash
# Set your API key
connect-exa config set-key YOUR_API_KEY

# Or use environment variable
export EXA_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-exa config set-key <key>     # Set API key
connect-exa config show              # Show config
connect-exa profile list             # List profiles
connect-exa profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-exa profile create work --api-key xxx --use
connect-exa profile create personal --api-key yyy

# Switch profiles
connect-exa profile use work

# Use profile for single command
connect-exa -p personal <command>

# List profiles
connect-exa profile list
```

## Library Usage

```typescript
import { Exa } from '@hasna/connect-exa';

const client = new Exa({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `EXA_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.connect/connect-exa/`:

```
~/.connect/connect-exa/
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
