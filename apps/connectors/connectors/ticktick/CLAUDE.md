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

Uses **Bearer token** authentication with the TickTick Open API:

```typescript
'Authorization': `Bearer ${this.accessToken}`
```

Obtain an access token from the [TickTick Developer Portal](https://developer.ticktick.com/manage) (register an app, authorize with scopes `tasks:read` and `tasks:write`, then store the token via `connect-ticktick config set-token <token>` or `TICKTICK_ACCESS_TOKEN`).

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TICKTICK_ACCESS_TOKEN` | API access token (overrides profile config) |

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
