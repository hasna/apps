# connect-pandadoc

PandaDoc API connector - A TypeScript CLI for the PandaDoc API with multi-profile support

## Installation

```bash
bun install -g @hasna/connect-pandadoc
```

## Quick Start

```bash
# Set your API key
connect-pandadoc config set-key YOUR_API_KEY

# Or use environment variable
export PANDADOC_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-pandadoc config set-key <key>     # Set API key
connect-pandadoc config show              # Show config
connect-pandadoc profile list             # List profiles
connect-pandadoc profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-pandadoc profile create work --api-key xxx --use
connect-pandadoc profile create personal --api-key yyy

# Switch profiles
connect-pandadoc profile use work

# Use profile for single command
connect-pandadoc -p personal <command>

# List profiles
connect-pandadoc profile list
```

## Library Usage

```typescript
import { Pandadoc } from '@hasna/connect-pandadoc';

const client = new Pandadoc({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PANDADOC_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.connect/connect-pandadoc/`:

```
~/.connect/connect-pandadoc/
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
