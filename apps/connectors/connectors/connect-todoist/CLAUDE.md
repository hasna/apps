# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-todoist is a TypeScript connector for the Todoist API. It provides CLI and library access to manage projects, tasks, sections, labels, and comments.

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

# Run specific commands
bun run dev project list
bun run dev task list
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
│   └── index.ts      # Todoist API wrapper class
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

### Projects
- List, get, create, update, delete projects
- Get project collaborators

### Sections
- List, get, create, update, delete sections

### Tasks
- List, get, create, update, delete tasks
- Close (complete) and reopen tasks
- Filter tasks by project, section, label, or filter expression

### Labels
- List, get, create, update, delete labels

### Comments
- List, get, create, update, delete comments
- Comments can be attached to tasks or projects

## Authentication

Uses Bearer token authentication with the Todoist REST API v2:
```typescript
'Authorization': `Bearer ${this.apiKey}`
```

Get your API token from: https://todoist.com/app/settings/integrations/developer

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TODOIST_API_KEY` | API token (overrides profile config) |

## Data Storage

```
~/.connect/connect-todoist/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
