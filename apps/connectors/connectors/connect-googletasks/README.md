# connect-googletasks

Google Tasks API connector - Manage task lists and tasks

## Installation

```bash
bun install -g @hasna/connect-googletasks
```

## Quick Start

```bash
# Set your API key
connect-googletasks config set-key YOUR_API_KEY

# Or use environment variable
export GOOGLE_CLIENT_ID=YOUR_API_KEY
```

## CLI Commands

### Authentication
```bash
connect-googletasks auth setup --client-id <id> --client-secret <secret>
connect-googletasks auth login
connect-googletasks auth callback <code>
connect-googletasks auth refresh
connect-googletasks auth logout
connect-googletasks auth status
```

### Task Lists
```bash
connect-googletasks lists list
connect-googletasks lists get <listId>
connect-googletasks lists create "My List"
connect-googletasks lists rename <listId> "New Name"
connect-googletasks lists delete <listId>
```

### Tasks
```bash
connect-googletasks tasks list <listId>
connect-googletasks tasks list <listId> --all          # Include completed
connect-googletasks tasks get <listId> <taskId>
connect-googletasks tasks add <listId> "Task title"
connect-googletasks tasks add <listId> "Task" -n "Notes" -d 2024-12-31
connect-googletasks tasks update <listId> <taskId> -t "New title"
connect-googletasks tasks complete <listId> <taskId>
connect-googletasks tasks uncomplete <listId> <taskId>
connect-googletasks tasks delete <listId> <taskId>
connect-googletasks tasks move <listId> <taskId> --after <otherId>
connect-googletasks tasks clear <listId>              # Clear completed
```

### Profiles
```bash
connect-googletasks profile list
connect-googletasks profile create <name>
connect-googletasks profile use <name>
connect-googletasks profile delete <name>
```

## Profile Management

```bash
# Create profiles for different accounts
connect-googletasks profile create work --api-key xxx --use
connect-googletasks profile create personal --api-key yyy

# Switch profiles
connect-googletasks profile use work

# Use profile for single command
connect-googletasks -p personal <command>

# List profiles
connect-googletasks profile list
```

## Library Usage

```typescript
import { Googletasks } from '@hasna/connect-googletasks';

const client = new Googletasks({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | OAuth Client ID (overrides profile) |
| `GOOGLE_CLIENT_SECRET` | OAuth Client Secret (overrides profile) |
| `GOOGLE_ACCESS_TOKEN` | Access token (overrides profile) |

## Data Storage

Configuration stored in `~/.connect/connect-googletasks/`:

```
~/.connect/connect-googletasks/
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
