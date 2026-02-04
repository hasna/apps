# connect-stabilityai

Stability AI API connector CLI - Image generation, editing, upscaling, and 3D model generation

## Installation

```bash
bun install -g @hasna/connect-stabilityai
```

## Quick Start

```bash
# Set your API key
connect-stabilityai config set-key YOUR_API_KEY

# Or use environment variable
export STABILITYAI_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-stabilityai config set-key <key>     # Set API key
connect-stabilityai config show              # Show config
connect-stabilityai profile list             # List profiles
connect-stabilityai profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-stabilityai profile create work --api-key xxx --use
connect-stabilityai profile create personal --api-key yyy

# Switch profiles
connect-stabilityai profile use work

# Use profile for single command
connect-stabilityai -p personal <command>

# List profiles
connect-stabilityai profile list
```

## Library Usage

```typescript
import { Stabilityai } from '@hasna/connect-stabilityai';

const client = new Stabilityai({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STABILITYAI_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.connect/connect-stabilityai/`:

```
~/.connect/connect-stabilityai/
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
