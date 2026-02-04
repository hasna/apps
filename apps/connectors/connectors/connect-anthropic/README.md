# connect-anthropic

Anthropic API connector CLI - Claude models for chat and code generation

## Installation

```bash
bun install -g @hasna/connect-anthropic
```

## Quick Start

```bash
# Set your API key
connect-anthropic config set-key YOUR_API_KEY

# Or use environment variable
export ANTHROPIC_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
# Quick commands
connect-anthropic ask <question>
connect-anthropic models

# Messages commands
connect-anthropic messages ask <question> [-m model] [-t temp] [-s system]
connect-anthropic messages code <prompt> [-m model]
connect-anthropic messages json <prompt> [-m model]

# Config
connect-anthropic config set-key <key>
connect-anthropic config set-model <model>
connect-anthropic config show

# Profiles
connect-anthropic profile list|use|create|delete|show
```

## Profile Management

```bash
# Create profiles for different accounts
connect-anthropic profile create work --api-key xxx --use
connect-anthropic profile create personal --api-key yyy

# Switch profiles
connect-anthropic profile use work

# Use profile for single command
connect-anthropic -p personal <command>

# List profiles
connect-anthropic profile list
```

## Library Usage

```typescript
import { Anthropic } from '@hasna/connect-anthropic';

const client = new Anthropic({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.connect/connect-anthropic/`:

```
~/.connect/connect-anthropic/
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
