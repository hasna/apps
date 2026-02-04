# connect-huggingface

HuggingFace API connector - A TypeScript client for the HuggingFace API with multi-profile support

## Installation

```bash
bun install -g @hasna/connect-huggingface
```

## Quick Start

```bash
# Set your API key
connect-huggingface config set-key YOUR_API_KEY

# Or use environment variable
export HUGGINGFACE_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-huggingface config set-key <key>     # Set API key
connect-huggingface config show              # Show config
connect-huggingface profile list             # List profiles
connect-huggingface profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-huggingface profile create work --api-key xxx --use
connect-huggingface profile create personal --api-key yyy

# Switch profiles
connect-huggingface profile use work

# Use profile for single command
connect-huggingface -p personal <command>

# List profiles
connect-huggingface profile list
```

## Library Usage

```typescript
import { Huggingface } from '@hasna/connect-huggingface';

const client = new Huggingface({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `HUGGINGFACE_API_KEY` | API key (overrides profile) |
| `HF_TOKEN` | Alternative API key (HuggingFace convention) |
| `HUGGINGFACE_API_SECRET` | API secret (optional) |
| `HUGGINGFACE_BASE_URL` | Override base URL |

## Data Storage

Configuration stored in `~/.connect/connect-huggingface/`:

```
~/.connect/connect-huggingface/
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
