# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-linear is a TypeScript CLI and library for Linear's GraphQL API. It provides issue management, project management, team operations, and user operations with multi-profile support for managing multiple Linear workspaces.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Async/await for all async operations
- Minimal dependencies: commander, chalk

## Project Structure

```
src/
├── api/
│   ├── client.ts     # GraphQL client with Bearer auth
│   ├── issues.ts     # Issues API
│   ├── projects.ts   # Projects API
│   ├── teams.ts      # Teams API
│   ├── users.ts      # Users API
│   └── index.ts      # Main Linear class
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # TypeScript types
├── utils/
│   ├── config.ts     # Multi-profile configuration
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## API Architecture

The Linear API uses GraphQL. The client architecture:

1. `LinearClient` - Base GraphQL client that handles authentication and requests
2. API modules (Issues, Projects, Teams, Users) - Use the client to make specific queries/mutations
3. `Linear` class - Main entry point that combines all API modules

## Environment Variables

| Variable | Description |
|----------|-------------|
| `LINEAR_API_KEY` | Linear API key |

## Multi-Profile Configuration

Configuration stored in `~/.connect/connect-linear/`:

```
~/.connect/connect-linear/
├── current_profile
└── profiles/
    └── default/
        └── config.json
```

## GraphQL Endpoint

- Base URL: https://api.linear.app/graphql
- Auth: Bearer token (API key sent directly as Authorization header)

## Dependencies

- commander: CLI framework
- chalk: Terminal styling

## Priority Values

- 0: No priority
- 1: Urgent
- 2: High
- 3: Normal
- 4: Low
