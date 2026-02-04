# connect-firecrawl

Firecrawl web scraping API connector - Scrape, crawl, and map websites with AI-powered extraction

## Installation

```bash
bun install -g @hasna/connect-firecrawl
```

## Quick Start

```bash
# Set your API key
connect-firecrawl config set-key YOUR_API_KEY

# Or use environment variable
export FIRECRAWL_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-firecrawl config set-key <key>     # Set API key
connect-firecrawl config show              # Show config
connect-firecrawl profile list             # List profiles
connect-firecrawl profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-firecrawl profile create work --api-key xxx --use
connect-firecrawl profile create personal --api-key yyy

# Switch profiles
connect-firecrawl profile use work

# Use profile for single command
connect-firecrawl -p personal <command>

# List profiles
connect-firecrawl profile list
```

## Library Usage

```typescript
import { Firecrawl } from '@hasna/connect-firecrawl';

const client = new Firecrawl({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `FIRECRAWL_API_KEY` | API key (required) |
| `FIRECRAWL_BASE_URL` | Override base URL (default: https://api.firecrawl.dev/v1) |

## Data Storage

Configuration stored in `~/.connect/connect-firecrawl/`:

```
~/.connect/connect-firecrawl/
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
