# connect-uspto

USPTO API connector CLI - Patent and trademark search with browser automation

## Installation

```bash
bun install -g @hasna/connect-uspto
```

## Quick Start

```bash
# Set your API key
connect-uspto config set-key YOUR_API_KEY

# Or use environment variable
export USPTO_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-uspto config set-key <key>     # Set API key
connect-uspto config show              # Show config
connect-uspto profile list             # List profiles
connect-uspto profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-uspto profile create work --api-key xxx --use
connect-uspto profile create personal --api-key yyy

# Switch profiles
connect-uspto profile use work

# Use profile for single command
connect-uspto -p personal <command>

# List profiles
connect-uspto profile list
```

## Library Usage

```typescript
import { Uspto } from '@hasna/connect-uspto';

const client = new Uspto({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `USPTO_API_KEY` | API key (optional for most APIs) |
| `USPTO_TOKEN` | Alternative API key variable |
| `USPTO_HEADLESS` | Run browser in headless mode (default: true) |
| `USPTO_BROWSER` | Browser to use: chromium, firefox, webkit |
| `USPTO_OUTPUT_DIR` | Output directory for downloads |

## Data Storage

Configuration stored in `~/.connect/connect-uspto/`:

```
~/.connect/connect-uspto/
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
