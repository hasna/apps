# connect-codeclimate

Code Climate API connector CLI - Code quality and test coverage analysis

## Installation

```bash
bun install -g @hasna/connect-codeclimate
```

## Quick Start

```bash
# Set your API key
connect-codeclimate config set-key YOUR_API_KEY

# Or use environment variable
export CODECLIMATE_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-codeclimate config set-key <key>     # Set API key
connect-codeclimate config show              # Show config
connect-codeclimate profile list             # List profiles
connect-codeclimate profile use <name>       # Switch profile
```

## Profile Management

```bash
connect-codeclimate profile create work --api-key xxx --use
connect-codeclimate profile create personal --api-key yyy
connect-codeclimate profile use work
connect-codeclimate -p personal <command>
connect-codeclimate profile list
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-codeclimate';

const client = new Connector({ apiKey: 'YOUR_API_KEY' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CODECLIMATE_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.connect/connect-codeclimate/`:

```
~/.connect/connect-codeclimate/
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
