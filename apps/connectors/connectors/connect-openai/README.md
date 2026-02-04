# connect-openai

OpenAI API connector CLI - Chat, embeddings, and images

## Installation

```bash
bun install -g @hasna/connect-openai
```

## Quick Start

```bash
# Set your API key
connect-openai config set-key YOUR_API_KEY

# Or use environment variable
export OPENAI_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-openai config set-key <key>     # Set API key
connect-openai config show              # Show config
connect-openai profile list             # List profiles
connect-openai profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-openai profile create work --api-key xxx --use
connect-openai profile create personal --api-key yyy

# Switch profiles
connect-openai profile use work

# Use profile for single command
connect-openai -p personal <command>

# List profiles
connect-openai profile list
```

## Library Usage

```typescript
import { Openai } from '@hasna/connect-openai';

const client = new Openai({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | API key |
| `OPENAI_ORGANIZATION` | Organization ID |

## Data Storage

Configuration stored in `~/.connect/connect-openai/`:

```
~/.connect/connect-openai/
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
