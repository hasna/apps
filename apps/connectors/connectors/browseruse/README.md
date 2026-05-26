# connect-browseruse

TypeScript connector for Browser Use Cloud API (browser-use.com) - AI-powered browser automation tasks, sessions, and skills.

## Features

- Full Browser Use Cloud API support
- Multi-profile configuration (switch between different API keys/accounts)
- Bearer token authentication
- Clean CLI structure with Commander.js
- Pretty and JSON output formats
- TypeScript with strict mode

## Installation

```bash
npm install -g @hasna/connect-browseruse
# or
bun add -g @hasna/connect-browseruse
```

## Quick Start

### Configure API Key

```bash
# Set API key
connect-browseruse config set api-key bu_your_api_key

# Or use environment variable
export BROWSER_USE_API_KEY=bu_your_api_key
```

### Run a Task

```bash
# Quick task execution
connect-browseruse run "Navigate to google.com and search for AI news"

# Create a task with options
connect-browseruse tasks create "Fill out the contact form on example.com" --save-browser
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
connect-browseruse profiles create --name "Work" # Create profile
connect-browseruse profiles delete <id>          # Delete profile
```

### Skills

```bash
connect-browseruse skills list                   # List user skills
connect-browseruse skills get <id>               # Get skill details
connect-browseruse skills create --name "Login"  # Create skill
connect-browseruse skills delete <id>            # Delete skill
connect-browseruse skills run <id> -p '{"url":"example.com"}' # Run skill
```

### Marketplace

```bash
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

## Programmatic Usage

```typescript
import { BrowserUse } from '@hasna/connect-browseruse';

// Create client
const browserUse = new BrowserUse({
  apiKey: process.env.BROWSER_USE_API_KEY!,
});

// Or create from environment
const browserUse = BrowserUse.fromEnv();

// Run a quick task
const result = await browserUse.run('Navigate to google.com and get the page title');
console.log(result);

// Create a task with more control
const task = await browserUse.tasks.create({
  task: 'Fill out the contact form',
  saveBrowserSession: true,
});

// Wait for completion
const completed = await browserUse.tasks.waitForCompletion(task.id);
console.log(completed.output);

// List sessions
const sessions = await browserUse.sessions.list();

// Get billing info
const billing = await browserUse.billing.getAccount();
console.log(`Credits: ${billing.credits}`);
```

## Multi-Profile Configuration

Profiles are stored in `~/.hasna/connectors/connect-browseruse/profiles/`:

```
~/.hasna/connectors/connect-browseruse/
├── current_profile   # Name of active profile
└── profiles/
    ├── default.json  # Default profile
    ├── work.json     # Named profile
    └── personal.json # Named profile
```

### Profile Commands

```bash
# Create profiles
connect-browseruse profile create work
connect-browseruse config set api-key bu_work_key

# Switch profiles
connect-browseruse profile use work

# Use profile for single command
connect-browseruse -p personal tasks list

# List profiles
connect-browseruse profile list
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `BROWSER_USE_API_KEY` | Browser Use API key (overrides profile config) |
| `BROWSER_USE_BASE_URL` | Base URL (default: https://api.browser-use.com) |

## Development

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build for distribution
bun run build

# Type check
bun run typecheck
```

## API Reference

See the full API documentation at: https://docs.browser-use.com/cloud/api

## License

MIT
