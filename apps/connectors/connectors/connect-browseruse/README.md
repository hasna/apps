# connect-browseruse

Browser Use Cloud API connector CLI - AI-powered browser automation tasks, sessions, and skills

## Installation

```bash
bun install -g @hasna/connect-browseruse
```

## Quick Start

```bash
# Set your API key
connect-browseruse config set-key YOUR_API_KEY

# Or use environment variable
export BROWSER_USE_API_KEY=YOUR_API_KEY
```

## CLI Commands

### Tasks
```bash
connect-browseruse tasks list                    # List all tasks
connect-browseruse tasks create "Search for AI"  # Create new task
connect-browseruse tasks get <id>                # Get task details
connect-browseruse tasks stop <id>               # Stop running task
connect-browseruse tasks pause <id>              # Pause task
connect-browseruse tasks resume <id>             # Resume paused task
connect-browseruse tasks logs <id>               # View task logs
```

### Sessions
```bash
connect-browseruse sessions list                 # List sessions
connect-browseruse sessions get <id>             # Get session details
connect-browseruse sessions create               # Create new session
connect-browseruse sessions delete <id>          # Delete session
connect-browseruse sessions share <id>           # Create public share
connect-browseruse sessions unshare <id>         # Remove public share
```

### Browser Profiles
```bash
connect-browseruse profiles list                 # List browser profiles
connect-browseruse profiles get <id>             # Get profile details
connect-browseruse profiles create --name "My Profile" # Create profile
connect-browseruse profiles delete <id>          # Delete profile
```

### Skills & Marketplace
```bash
connect-browseruse skills list                   # List user skills
connect-browseruse skills get <id>               # Get skill details
connect-browseruse skills create --name "Login" --parameter "url:string" # Create skill
connect-browseruse skills delete <id>            # Delete skill
connect-browseruse skills run <id> -p '{"url":"example.com"}' # Run skill

connect-browseruse marketplace list              # List marketplace skills
connect-browseruse marketplace get <id>          # Get marketplace skill
```

### Billing
```bash
connect-browseruse billing show                  # Show billing info
connect-browseruse billing credits               # Show credit balance
connect-browseruse billing plan                  # Show current plan
```

### Quick Run
```bash
connect-browseruse run "Navigate to google.com"  # Quick task execution
connect-browseruse run "Search for news" --timeout 120000
```

### Profile & Config
```bash
connect-browseruse profile list                  # List profiles
connect-browseruse profile use <name>            # Switch profile
connect-browseruse profile create <name>         # Create profile
connect-browseruse profile delete <name>         # Delete profile
connect-browseruse config set api-key <key>      # Set API key
connect-browseruse config set base-url <url>     # Set base URL
connect-browseruse config show                   # Show current config
```

## Profile Management

```bash
# Create profiles for different accounts
connect-browseruse profile create work --api-key xxx --use
connect-browseruse profile create personal --api-key yyy

# Switch profiles
connect-browseruse profile use work

# Use profile for single command
connect-browseruse -p personal <command>

# List profiles
connect-browseruse profile list
```

## Library Usage

```typescript
import { Browseruse } from '@hasna/connect-browseruse';

const client = new Browseruse({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `BROWSER_USE_API_KEY` | Browser Use API key (overrides profile) |
| `BROWSER_USE_BASE_URL` | Base URL (default: https://api.browser-use.com) |

## Data Storage

Configuration stored in `~/.connect/connect-browseruse/`:

```
~/.connect/connect-browseruse/
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
