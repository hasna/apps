# connect-configcat

ConfigCat API connector CLI - Feature flags and configuration management

## Installation

```bash
bun install -g @hasna/connect-configcat
```

## Quick Start

```bash
# Set your API key
connect-configcat config set-key YOUR_API_KEY

# Or use environment variable
export CONFIGCAT_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-configcat config set-key <key>     # Set API key
connect-configcat config show              # Show config
connect-configcat profile list             # List profiles
connect-configcat profile use <name>       # Switch profile
```

## Profile Management

```bash
connect-configcat profile create work --api-key xxx --use
connect-configcat profile create personal --api-key yyy
connect-configcat profile use work
connect-configcat -p personal <command>
connect-configcat profile list
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-configcat';

const client = new Connector({ apiKey: 'YOUR_API_KEY' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CONFIGCAT_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.connect/connect-configcat/`:

```
~/.connect/connect-configcat/
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
