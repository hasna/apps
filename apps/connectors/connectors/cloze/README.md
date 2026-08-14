# connect-cloze

Cloze API connector CLI - CRM for relationship management and sales tracking

## Installation

```bash
bun install -g @hasna/connect-cloze
```

## Quick Start

```bash
# Set your API key
connect-cloze config set-key YOUR_API_KEY

# Or use environment variable
export CLOZE_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-cloze config set-key <key>     # Set API key
connect-cloze config show              # Show config
connect-cloze profile list             # List profiles
connect-cloze profile use <name>       # Switch profile
```

## Profile Management

```bash
connect-cloze profile create work --api-key xxx --use
connect-cloze profile create personal --api-key yyy
connect-cloze profile use work
connect-cloze -p personal <command>
connect-cloze profile list
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-cloze';

const client = new Connector({ apiKey: 'YOUR_API_KEY' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CLOZE_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.hasna/connectors/connect-cloze/`:

```
~/.hasna/connectors/connect-cloze/
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
