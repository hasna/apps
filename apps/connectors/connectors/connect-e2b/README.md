# connect-e2b

E2B Code Interpreter API connector - Run code in secure cloud sandboxes

## Installation

```bash
bun install -g @hasna/connect-e2b
```

## Quick Start

```bash
# Set your API key
connect-e2b config set-key YOUR_API_KEY

# Or use environment variable
export E2B_API_KEY=YOUR_API_KEY
```

## CLI Commands

### Sandbox Management

```bash
connect-e2b sandbox create [--template <template>] [--timeout <ms>]
connect-e2b sandbox list
connect-e2b sandbox get <sandboxId>
connect-e2b sandbox kill <sandboxId>
connect-e2b sandbox keep-alive <sandboxId> [--timeout <ms>]
```

### Code Execution

```bash
connect-e2b run "<code>" [--language <lang>] [--sandbox <id>] [--no-cleanup]
connect-e2b exec "<command>" [--sandbox <id>] [--workdir <path>]
```

### File Operations

```bash
connect-e2b file read <sandboxId> <path>
connect-e2b file write <sandboxId> <path> <content>
connect-e2b file list <sandboxId> [path]
connect-e2b file mkdir <sandboxId> <path>
connect-e2b file rm <sandboxId> <path>
```

### Configuration

```bash
connect-e2b config set-key <apiKey>
connect-e2b config set-template <template>
connect-e2b config set-timeout <ms>
connect-e2b config show
connect-e2b config clear
```

### Profile Management

```bash
connect-e2b profile list
connect-e2b profile create <name> [--api-key <key>] [--use]
connect-e2b profile use <name>
connect-e2b profile delete <name>
connect-e2b profile show [name]
```

## Profile Management

```bash
# Create profiles for different accounts
connect-e2b profile create work --api-key xxx --use
connect-e2b profile create personal --api-key yyy

# Switch profiles
connect-e2b profile use work

# Use profile for single command
connect-e2b -p personal <command>

# List profiles
connect-e2b profile list
```

## Library Usage

```typescript
import { E2b } from '@hasna/connect-e2b';

const client = new E2b({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `E2B_API_KEY` | E2B API key (required) |
| `E2B_BASE_URL` | Override base URL (optional) |

## Data Storage

Configuration stored in `~/.connect/connect-e2b/`:

```
~/.connect/connect-e2b/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Development

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build
bun run build

# Type check
bun run typecheck
```

## License

MIT
