# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-turbot-pipes is a TypeScript connector for the Turbot Pipes cloud intelligence API. It provides a CLI and programmatic interface for workspaces, snapshots, SQL queries, and processes.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
```

## CLI Commands

```bash
# Authentication
connect-turbot-pipes config set-token <token>   # Set API token
connect-turbot-pipes config show                # Show current config
connect-turbot-pipes config clear               # Clear config

# Profile management
connect-turbot-pipes profile list               # List profiles
connect-turbot-pipes profile use <name>         # Switch profile
connect-turbot-pipes profile create <name>      # Create profile
connect-turbot-pipes profile delete <name>      # Delete profile

# Validation
connect-turbot-pipes validate                   # Validate credentials

# User
connect-turbot-pipes user                       # Get current user

# Workspaces
connect-turbot-pipes workspaces list --org <orgHandle>
connect-turbot-pipes workspace get --org <orgHandle> --workspace <workspaceHandle>

# Snapshots
connect-turbot-pipes snapshots list --org <orgHandle> --workspace <workspaceHandle>

# Queries
connect-turbot-pipes query run --org <orgHandle> --workspace <workspaceHandle> --sql "select 1"

# Processes
connect-turbot-pipes processes list --org <orgHandle> --workspace <workspaceHandle>
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TURBOT_PIPES_API_TOKEN` | API token (overrides profile) |

## Authentication

Uses Bearer Token authentication. Get your API token from https://pipes.turbot.com

```typescript
'Authorization': `Bearer ${apiToken}`,
```

## Data Storage

```
~/.hasna/connectors/connect-turbot-pipes/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "apiToken": "xxx"
}
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Type annotations required everywhere

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with Bearer auth
│   └── index.ts      # Turbot Pipes API wrapper
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   ├── config.ts     # Multi-profile configuration
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## API Coverage

- User: Get current user (`GET /user`)
- Workspaces: List org workspaces, get workspace details
- Snapshots: List workspace snapshots with pagination
- Queries: Run SQL queries with optional parameters
- Processes: List workspace processes with pagination

Base URL: `https://pipes.turbot.com/api/latest`

Docs: https://pipes.turbot.com/api/latest/docs
