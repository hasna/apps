# connect-cockpit

Cockpit CMS API connector CLI - Headless CMS content management

## Installation

```bash
bun install -g @hasna/connect-cockpit
```

## Quick Start

```bash
# Set your API key
connect-cockpit config set-key YOUR_API_KEY

# Or use environment variable
export COCKPIT_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-cockpit config set-key <key>     # Set API key
connect-cockpit config show              # Show config
connect-cockpit profile list             # List profiles
connect-cockpit profile use <name>       # Switch profile
```

## Profile Management

```bash
connect-cockpit profile create work --api-key xxx --use
connect-cockpit profile create personal --api-key yyy
connect-cockpit profile use work
connect-cockpit -p personal <command>
connect-cockpit profile list
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-cockpit';

const client = new Connector({ apiKey: 'YOUR_API_KEY' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `COCKPIT_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.connect/connect-cockpit/`:

```
~/.connect/connect-cockpit/
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
