# connect-mistral

Mistral AI API connector CLI - Chat completions and embeddings

## Installation

```bash
bun install -g @hasna/connect-mistral
```

## Quick Start

```bash
# Set your API key
connect-mistral config set-key YOUR_API_KEY

# Or use environment variable
export MISTRAL_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
# Quick commands
connect-mistral ask <question>
connect-mistral models

# Chat commands
connect-mistral chat ask <question> [-m model] [-t temp] [--safe]
connect-mistral chat code <prompt>
connect-mistral chat json <prompt>

# Embeddings
connect-mistral embed create <text>

# Config
connect-mistral config set-key <key>
connect-mistral config set-model <model>
connect-mistral config show

# Profiles
connect-mistral profile list|use|create|delete|show
```

## Profile Management

```bash
# Create profiles for different accounts
connect-mistral profile create work --api-key xxx --use
connect-mistral profile create personal --api-key yyy

# Switch profiles
connect-mistral profile use work

# Use profile for single command
connect-mistral -p personal <command>

# List profiles
connect-mistral profile list
```

## Library Usage

```typescript
import { Mistral } from '@hasna/connect-mistral';

const client = new Mistral({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MISTRAL_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.connect/connect-mistral/`:

```
~/.connect/connect-mistral/
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
