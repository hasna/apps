# connect-resend

Resend Email API connector CLI - Send emails, manage templates, domains, API keys, audiences, contacts, webhooks, and broadcasts

## Installation

```bash
bun install -g @hasna/connect-resend
```

## Quick Start

```bash
# Set your API key
connect-resend config set-key YOUR_API_KEY

# Or use environment variable
export RESEND_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-resend config set-key <key>     # Set API key
connect-resend config show              # Show config
connect-resend profile list             # List profiles
connect-resend profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-resend profile create work --api-key xxx --use
connect-resend profile create personal --api-key yyy

# Switch profiles
connect-resend profile use work

# Use profile for single command
connect-resend -p personal <command>

# List profiles
connect-resend profile list
```

## Library Usage

```typescript
import { Resend } from '@hasna/connect-resend';

const client = new Resend({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `RESEND_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.connect/connect-resend/`:

```
~/.connect/connect-resend/
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
