# connect-codefresh

Codefresh API connector CLI - CI/CD pipeline management and GitOps

## Installation

```bash
bun install -g @hasna/connect-codefresh
```

## Quick Start

```bash
# Set your API key
connect-codefresh config set-key YOUR_API_KEY

# Or use environment variable
export CODEFRESH_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-codefresh config set-key <key>     # Set API key
connect-codefresh config show              # Show config
connect-codefresh profile list             # List profiles
connect-codefresh profile use <name>       # Switch profile
```

## Profile Management

```bash
connect-codefresh profile create work --api-key xxx --use
connect-codefresh profile create personal --api-key yyy
connect-codefresh profile use work
connect-codefresh -p personal <command>
connect-codefresh profile list
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-codefresh';

const client = new Connector({ apiKey: 'YOUR_API_KEY' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CODEFRESH_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.hasna/connectors/connect-codefresh/`:

```
~/.hasna/connectors/connect-codefresh/
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
