# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-split-io is a TypeScript connector for Split.io's Admin API v2. It provides a CLI and programmatic interface for managing feature flags (splits), segments, environments, traffic types, change requests, metrics, and users.

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
connect-split-io config set-api-key <key>   # Set Admin API key
connect-split-io config show                  # Show current config
connect-split-io config clear                 # Clear config
connect-split-io validate                     # Validate credentials

# Profile management
connect-split-io profile list
connect-split-io profile use <name>
connect-split-io profile create <name>
connect-split-io profile delete <name>

# Workspaces
connect-split-io workspaces list

# Environments
connect-split-io environments list <workspaceId>
connect-split-io environments create <workspaceId> --name <name>
connect-split-io environments delete <workspaceId> <environmentName>

# Traffic types
connect-split-io traffic-types list <workspaceId>
connect-split-io traffic-types create <workspaceId> --name <name>
connect-split-io traffic-types delete <trafficTypeId>

# Splits (feature flags)
connect-split-io splits list <workspaceId>
connect-split-io splits get <workspaceId> <splitName>
connect-split-io splits create <workspaceId> <trafficTypeId> --name <name>
connect-split-io splits definition get <workspaceId> <splitName> <environmentName>
connect-split-io splits kill <workspaceId> <splitName> <environmentName>
connect-split-io splits restore <workspaceId> <splitName> <environmentName>

# Segments
connect-split-io segments list <workspaceId>
connect-split-io segments keys <segmentName> <environmentName>
connect-split-io segments add-keys <segmentName> <environmentName> --keys <key...>

# Tags, metrics, change requests, attributes, groups, users
connect-split-io tags list <workspaceId>
connect-split-io metrics list <workspaceId>
connect-split-io change-requests list
connect-split-io attributes list <workspaceId> <trafficTypeId>
connect-split-io groups list
connect-split-io users list
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SPLIT_IO_API_KEY` | Admin API key (overrides profile) |

## Authentication

Uses Bearer token authentication with the Split.io Admin API key.

- **Auth type**: bearer
- **API key field**: api_key
- Base URL: `https://api.split.io/internal/api/v2`
- Docs: https://docs.split.io/reference/

Get your Admin API key from: https://app.split.io/account/admin

## Data Storage

```
~/.hasna/connectors/connect-split-io/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "apiKey": "xxx"
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
│   ├── client.test.ts
│   └── index.ts      # Split.io API wrapper
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

Admin API v2 endpoints for workspaces, environments, traffic types, splits (CRUD + definitions + kill/restore), segments (+ keys), tags, metrics, change requests, attribute schemas, groups, and users.
