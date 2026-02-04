# connect-twilio

Twilio API connector CLI - A TypeScript wrapper for the Twilio API

## Installation

```bash
bun install -g @hasna/connect-twilio
```

## Quick Start

```bash
# Set your API key
connect-twilio config set-key YOUR_API_KEY

# Or use environment variable
export TWILIO_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-twilio config set-key <key>     # Set API key
connect-twilio config show              # Show config
connect-twilio profile list             # List profiles
connect-twilio profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-twilio profile create work --api-key xxx --use
connect-twilio profile create personal --api-key yyy

# Switch profiles
connect-twilio profile use work

# Use profile for single command
connect-twilio -p personal <command>

# List profiles
connect-twilio profile list
```

## Library Usage

```typescript
import { Twilio } from '@hasna/connect-twilio';

const client = new Twilio({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TWILIO_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.connect/connect-twilio/`:

```
~/.connect/connect-twilio/
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
