# connect-shadcn

Shadcn CLI wrapper - Execute shadcn commands programmatically with multi-profile support

## Installation

```bash
bun install -g @hasna/connect-shadcn
```

## Quick Start

```bash
# Set your API key
connect-shadcn config set-key YOUR_API_KEY

# Or use environment variable
export CI=YOUR_API_KEY
```

## CLI Commands

```bash
connect-shadcn config set-key <key>     # Set API key
connect-shadcn config show              # Show config
connect-shadcn profile list             # List profiles
connect-shadcn profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-shadcn profile create work --api-key xxx --use
connect-shadcn profile create personal --api-key yyy

# Switch profiles
connect-shadcn profile use work

# Use profile for single command
connect-shadcn -p personal <command>

# List profiles
connect-shadcn profile list
```

## Library Usage

```typescript
import { Shadcn } from '@hasna/connect-shadcn';

const client = new Shadcn({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CI` | Set to 'true' automatically for non-interactive mode |

## Data Storage

Configuration stored in `~/.connect/connect-shadcn/`:

```
~/.connect/connect-shadcn/
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
