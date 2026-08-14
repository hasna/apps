# connect-cody

Cody API connector CLI - Sourcegraph Cody AI coding assistant

## Installation

```bash
bun install -g @hasna/connect-cody
```

## Quick Start

```bash
# Set your API key
connect-cody config set-key YOUR_API_KEY

# Or use environment variable
export CODY_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-cody config set-key <key>     # Set API key
connect-cody config show              # Show config
connect-cody profile list             # List profiles
connect-cody profile use <name>       # Switch profile
```

## Profile Management

```bash
connect-cody profile create work --api-key xxx --use
connect-cody profile create personal --api-key yyy
connect-cody profile use work
connect-cody -p personal <command>
connect-cody profile list
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-cody';

const client = new Connector({ apiKey: 'YOUR_API_KEY' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CODY_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.hasna/connectors/connect-cody/`:

```
~/.hasna/connectors/connect-cody/
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
