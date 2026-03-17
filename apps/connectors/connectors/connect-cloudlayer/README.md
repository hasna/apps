# connect-cloudlayer

CloudLayer API connector CLI - Generate PDFs, screenshots, and images from HTML/URLs

## Installation

```bash
bun install -g @hasna/connect-cloudlayer
```

## Quick Start

```bash
# Set your API key
connect-cloudlayer config set-key YOUR_API_KEY

# Or use environment variable
export CLOUDLAYER_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-cloudlayer config set-key <key>     # Set API key
connect-cloudlayer config show              # Show config
connect-cloudlayer profile list             # List profiles
connect-cloudlayer profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-cloudlayer profile create work --api-key xxx --use
connect-cloudlayer profile create personal --api-key yyy

# Switch profiles
connect-cloudlayer profile use work

# Use profile for single command
connect-cloudlayer -p personal <command>

# List profiles
connect-cloudlayer profile list
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-cloudlayer';

const client = new Connector({ apiKey: 'YOUR_API_KEY' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CLOUDLAYER_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.connect/connect-cloudlayer/`:

```
~/.connect/connect-cloudlayer/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Development

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## License

Apache-2.0
