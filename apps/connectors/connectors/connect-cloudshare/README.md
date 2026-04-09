# connect-cloudshare

CloudShare API connector CLI - Virtual training labs and demo environments

## Installation

```bash
bun install -g @hasna/connect-cloudshare
```

## Quick Start

```bash
# Set your API key
connect-cloudshare config set-key YOUR_API_KEY

# Or use environment variable
export CLOUDSHARE_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-cloudshare config set-key <key>     # Set API key
connect-cloudshare config show              # Show config
connect-cloudshare profile list             # List profiles
connect-cloudshare profile use <name>       # Switch profile
```

## Profile Management

```bash
connect-cloudshare profile create work --api-key xxx --use
connect-cloudshare profile create personal --api-key yyy
connect-cloudshare profile use work
connect-cloudshare -p personal <command>
connect-cloudshare profile list
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-cloudshare';

const client = new Connector({ apiKey: 'YOUR_API_KEY' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CLOUDSHARE_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.hasna/connectors/connect-cloudshare/`:

```
~/.hasna/connectors/connect-cloudshare/
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
