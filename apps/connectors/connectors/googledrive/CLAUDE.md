# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Google Drive API connector CLI - A TypeScript wrapper for Google Drive with OAuth2 authentication

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

## API Updates (2026)

### Deprecation (Feb 2026)
`enforceExpansiveAccess` query parameter is now deprecated for all methods in the permissions resource (v2 and v3). To restrict item access, use **folders with limited access** setting instead.

## Authentication

OAuth authentication (Google OAuth2). Credentials can be set via:
- OAuth flow through the dashboard
- Profile configuration with client credentials at `~/.hasna/connectors/connect-googledrive/credentials.json`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLEDRIVE_CLIENT_ID` | OAuth client ID |
| `GOOGLEDRIVE_CLIENT_SECRET` | OAuth client secret |

## Data Storage

```
~/.hasna/connectors/connect-googledrive/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
