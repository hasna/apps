# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-pinterest is a TypeScript connector for the Pinterest API v5. It provides CLI and library access to manage pins, boards, sections, and user content.

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
bun run dev user me
bun run dev board list
bun run dev pin get <id>
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
│   └── index.ts      # Pinterest API wrapper class
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

### User Account
- Get current user info
- Get user analytics

### Boards
- List, get, create, update, delete boards
- List pins in a board

### Board Sections
- List, create, update, delete sections
- List pins in a section

### Pins
- Get, create, update, delete pins
- Save pin to board
- Get pin analytics

### Search
- Search user pins
- Search user boards

### Following
- List following boards
- Follow/unfollow boards

### Media
- Register media uploads (video)

## Authentication

Uses OAuth 2.0 Bearer token authentication:
```typescript
'Authorization': `Bearer ${this.accessToken}`
```

Requires:
- Access Token (from Pinterest OAuth flow)

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PINTEREST_ACCESS_TOKEN` | Access token (overrides profile) |

## Data Storage

```
~/.connect/connect-pinterest/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
