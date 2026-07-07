# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-ticktick is a TypeScript connector for the [TickTick Open API](https://developer.ticktick.com/). It provides CLI and library access to manage projects and tasks.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun run dev project list
bun run dev task get <projectId> <taskId>
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
│   ├── client.ts     # HTTP client with Bearer token auth
│   └── index.ts      # TickTick API wrapper class
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

Base URL: `https://api.ticktick.com/open/v1`

### Projects
- List, get, get-with-data, create, update, delete projects

### Tasks
- Get, create, update, complete, delete tasks

## Authentication

Uses **Bearer token** authentication with the TickTick Open API. Obtain an OAuth2 access token from the [TickTick Developer Portal](https://developer.ticktick.com/manage):

1. Register an application and note the Client ID and Client Secret
2. Complete the OAuth2 authorization flow (scopes: `tasks:read`, `tasks:write`)
3. Store the resulting access token via `connect-ticktick config set-token <token>` or `TICKTICK_ACCESS_TOKEN`

```typescript
'Authorization': `Bearer ${this.accessToken}`
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TICKTICK_ACCESS_TOKEN` | OAuth2 access token (overrides profile config) |

## Data Storage

```
~/.hasna/connectors/connect-ticktick/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
