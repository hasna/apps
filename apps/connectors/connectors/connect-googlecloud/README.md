# connect-googlecloud

Google Cloud API connector - A TypeScript wrapper for Google Cloud Resource Manager API with multi-profile support

## Installation

```bash
bun install -g @hasna/connect-googlecloud
```

## Quick Start

```bash
# Set your API key
connect-googlecloud config set-key YOUR_API_KEY

# Or use environment variable
export GOOGLE_CLOUD_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-googlecloud config set-key <key>     # Set API key
connect-googlecloud config show              # Show config
connect-googlecloud profile list             # List profiles
connect-googlecloud profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-googlecloud profile create work --api-key xxx --use
connect-googlecloud profile create personal --api-key yyy

# Switch profiles
connect-googlecloud profile use work

# Use profile for single command
connect-googlecloud -p personal <command>

# List profiles
connect-googlecloud profile list
```

## Library Usage

```typescript
import { Googlecloud } from '@hasna/connect-googlecloud';

const client = new Googlecloud({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLOUD_API_KEY` | API key (overrides profile) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to service account JSON |
| `GOOGLE_CLOUD_BASE_URL` | Override base URL |

## Data Storage

Configuration stored in `~/.connect/connect-googlecloud/`:

```
~/.connect/connect-googlecloud/
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
