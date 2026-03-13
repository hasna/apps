# connect-coinbase

Coinbase API connector CLI - Cryptocurrency accounts, prices, and transactions

## Installation

```bash
bun install -g @hasna/connect-coinbase
```

## Quick Start

```bash
# Set your API key
connect-coinbase config set-key YOUR_API_KEY

# Or use environment variable
export COINBASE_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-coinbase config set-key <key>     # Set API key
connect-coinbase config show              # Show config
connect-coinbase profile list             # List profiles
connect-coinbase profile use <name>       # Switch profile
```

## Profile Management

```bash
connect-coinbase profile create work --api-key xxx --use
connect-coinbase profile create personal --api-key yyy
connect-coinbase profile use work
connect-coinbase -p personal <command>
connect-coinbase profile list
```

## Library Usage

```typescript
import { Coinbase } from '@hasna/connect-coinbase';

const client = new Coinbase({ apiKey: 'YOUR_API_KEY' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `COINBASE_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.connect/connect-coinbase/`:

```
~/.connect/connect-coinbase/
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
