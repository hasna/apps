# connect-collegefootballdata

College Football Data API connector CLI - NCAA football statistics, scores, and rankings

## Installation

```bash
bun install -g @hasna/connect-collegefootballdata
```

## Quick Start

```bash
# Set your API key
connect-collegefootballdata config set-key YOUR_API_KEY

# Or use environment variable
export COLLEGEFOOTBALLDATA_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-collegefootballdata config set-key <key>     # Set API key
connect-collegefootballdata config show              # Show config
connect-collegefootballdata profile list             # List profiles
connect-collegefootballdata profile use <name>       # Switch profile
```

## Profile Management

```bash
connect-collegefootballdata profile create work --api-key xxx --use
connect-collegefootballdata profile create personal --api-key yyy
connect-collegefootballdata profile use work
connect-collegefootballdata -p personal <command>
connect-collegefootballdata profile list
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-collegefootballdata';

const client = new Connector({ apiKey: 'YOUR_API_KEY' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `COLLEGEFOOTBALLDATA_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.hasna/connectors/connect-collegefootballdata/`:

```
~/.hasna/connectors/connect-collegefootballdata/
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
