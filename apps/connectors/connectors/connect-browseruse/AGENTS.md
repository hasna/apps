# AGENTS.md

This file provides guidance to AI coding agents when working with this repository.

## Project Overview

connect-browseruse is a TypeScript connector for Browser Use Cloud API (browser-use.com) with multi-profile configuration support. It provides CLI and programmatic access to AI-powered browser automation tasks, sessions, and skills.

## Build & Run Commands

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

## Code Style

- TypeScript with strict mode
- ESM modules (`type: module`)
- Async/await for all async operations
- Minimal dependencies: commander, chalk
- Type annotations required everywhere

## Project Structure

```
src/
├── api/           # API client modules
│   ├── client.ts  # HTTP client with authentication
│   └── index.ts   # Main connector class
├── cli/
│   └── index.ts   # CLI commands
├── types/
│   └── index.ts   # TypeScript types
├── utils/
│   ├── config.ts  # Multi-profile configuration
│   └── output.ts  # CLI output formatting
└── index.ts       # Library exports
```

## Authentication

Bearer Token authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-browseruse config set-key <key>`


## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/connect-browseruse/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### Authentication

Uses Bearer token authentication for all requests. API key can be set via:
- Environment variable: `BROWSER_USE_API_KEY`
- Profile configuration: `connect-browseruse config set api-key <key>`

### Service APIs

Each API endpoint has its own module:
- **TasksApi**: Create, list, get, stop, pause, resume tasks
- **SessionsApi**: Manage agent sessions with public sharing
- **ProfilesApi**: Browser profiles for persistent state
- **BrowsersApi**: Direct CDP browser sessions
- **SkillsApi**: User-created skills
- **MarketplaceApi**: Browse and discover marketplace skills
- **FilesApi**: Upload/download files via presigned URLs
- **BillingApi**: Account credits and plan info

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

## Environment Variables

| Variable | Description |
|----------|-------------|
| `BROWSER_USE_API_KEY` | Browser Use API key (overrides profile) |
| `BROWSER_USE_BASE_URL` | Base URL (default: https://api.browser-use.com) |

## Data Storage

```
~/.connect/connect-browseruse/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
