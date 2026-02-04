# connect-xai

xAI Grok API connector CLI - Chat completions with Grok models

## Installation

```bash
bun install -g @hasna/connect-xai
```

## Quick Start

```bash
# Set your API key
connect-xai config set-key YOUR_API_KEY

# Or use environment variable
export XAI_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
# Quick commands
connect-xai ask <question>
connect-xai models

# Chat commands
connect-xai chat ask <question> [-m model] [-t temp]
connect-xai chat code <prompt>
connect-xai chat json <prompt>

# Config
connect-xai config set-key <key>
connect-xai config set-model <model>
connect-xai config show

# Profiles
connect-xai profile list|use|create|delete|show
```

## Profile Management

```bash
# Create profiles for different accounts
connect-xai profile create work --api-key xxx --use
connect-xai profile create personal --api-key yyy

# Switch profiles
connect-xai profile use work

# Use profile for single command
connect-xai -p personal <command>

# List profiles
connect-xai profile list
```

## Library Usage

```typescript
import { Xai } from '@hasna/connect-xai';

const client = new Xai({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `XAI_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.connect/connect-xai/`:

```
~/.connect/connect-xai/
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
