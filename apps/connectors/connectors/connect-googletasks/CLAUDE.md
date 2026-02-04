# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-googletasks is a TypeScript connector for Google Tasks API. It provides CLI and programmatic access to manage task lists and tasks with OAuth 2.0 authentication.

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

OAuth authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-googletasks config set-key <key>`
- OAuth flow: `connect-googletasks oauth login`

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

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | OAuth Client ID (overrides profile) |
| `GOOGLE_CLIENT_SECRET` | OAuth Client Secret (overrides profile) |
| `GOOGLE_ACCESS_TOKEN` | Access token (overrides profile) |

## Data Storage

```
~/.connect/connect-googletasks/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
