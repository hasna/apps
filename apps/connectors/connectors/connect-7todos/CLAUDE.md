# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

connect-7todos is a TypeScript connector for the 7todos task management API. It provides a CLI and library for creating tasks via the 7todos API.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check

# Run specific commands
bun run dev config show
bun run dev tasks create --title "My task"
bun run dev profile list
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Minimal dependencies: commander, chalk only
- Type annotations required everywhere

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with key + workspaceId header auth
│   ├── tasks.ts      # Tasks API (create)
│   └── index.ts      # Main Connector class
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions (Task, CreateTaskParams)
├── utils/
│   ├── auth.ts       # OAuth2 authentication
│   ├── bulk.ts       # Bulk operation utilities
│   ├── config.ts     # Multi-profile configuration
│   ├── output.ts     # CLI output formatting
│   ├── settings.ts   # User preferences storage
│   └── storage.ts    # Local data storage
├── index.ts          # Library exports
scripts/
└── release.ts        # Release automation
```

## API Details

- **Base URL**: `https://7todos.com/api/v1`
- **Auth**: `key` header (API key) + `workspaceId` header
- **Endpoints**:
  - `POST /tasks/create` - Create a task (title required; optional: description, startDate, dueDate, state, complexity)

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SEVENTODOS_API_KEY` | API key (overrides profile) |
| `SEVENTODOS_WORKSPACE_ID` | Workspace ID (overrides profile) |
| `SEVENTODOS_TOKEN` | Token (alias for API key) |
| `SEVENTODOS_API_SECRET` | API secret (alias for workspace ID) |

## CLI Global Flags

| Flag | Description |
|------|-------------|
| `-k, --api-key <key>` | Override API key for this command |
| `-w, --workspace-id <id>` | Override workspace ID for this command |
| `-p, --profile <name>` | Use specific profile |
| `-f, --format <format>` | Output format (json, pretty) |
| `-v, --verbose` | Enable debug output |

## Data Storage

```
~/.connect/connect-7todos/
├── current_profile     # Active profile name
├── settings.json       # User preferences
└── profiles/
    ├── default.json    # Default profile
    └── {name}.json     # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
