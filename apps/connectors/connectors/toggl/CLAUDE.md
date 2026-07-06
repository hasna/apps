# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-toggl is a TypeScript connector for the Toggl Track REST API v9. It provides CLI and library access to manage workspaces, projects, clients, tags, tasks, and time entries.

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

# Run tests
bun test

# Run specific commands
bun run dev me show
bun run dev project list <workspaceId>
bun run dev config show
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
│   ├── client.ts     # HTTP client with Basic auth
│   ├── client.test.ts
│   └── index.ts      # Toggl API wrapper class
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

### Me
- Current user, workspaces, projects, clients, organizations, features

### Workspaces
- Get workspace, list users and groups

### Projects
- List, get, create, update, delete projects
- List project users

### Clients
- List, create, update, delete clients

### Tags
- List, create, delete tags

### Tasks
- List and create tasks

### Time Entries
- List, get current, get, create, update, delete, stop time entries

## Authentication

Uses Basic authentication with the Toggl Track API v9:

```typescript
Authorization: Basic base64(`${apiToken}:api_token`)
```

Get your API token from: https://track.toggl.com/profile

API documentation: https://engineering.toggl.com/docs/

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TOGGL_API_TOKEN` | API token (overrides profile config) |

## Data Storage

```
~/.hasna/connectors/connect-toggl/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
