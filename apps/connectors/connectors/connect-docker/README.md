# connect-docker

Docker Hub API connector - A TypeScript library and CLI for interacting with Docker Hub

## Installation

```bash
bun install -g @hasna/connect-docker
```

## Quick Start

```bash
# Set your API key
connect-docker config set-key YOUR_API_KEY

# Or use environment variable
export DOCKER_ACCESS_TOKEN=YOUR_API_KEY
```

## CLI Commands

```bash
connect-docker config set-key <key>     # Set API key
connect-docker config show              # Show config
connect-docker profile list             # List profiles
connect-docker profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-docker profile create work --api-key xxx --use
connect-docker profile create personal --api-key yyy

# Switch profiles
connect-docker profile use work

# Use profile for single command
connect-docker -p personal <command>

# List profiles
connect-docker profile list
```

## Library Usage

```typescript
import { Docker } from '@hasna/connect-docker';

const client = new Docker({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DOCKER_ACCESS_TOKEN` | Access token (recommended) |
| `DOCKER_USERNAME` | Docker Hub username |
| `DOCKER_PASSWORD` | Docker Hub password |
| `DOCKER_BASE_URL` | Override base URL |

## Data Storage

Configuration stored in `~/.connect/connect-docker/`:

```
~/.connect/connect-docker/
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
