# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-smartsheet is a TypeScript connector for the Smartsheet REST API 2.0. It provides a CLI and library for managing sheets, rows, columns, folders, workspaces, reports, attachments, discussions, automation rules, users, contacts, and webhooks.

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
bun run dev auth status
bun run dev sheets list
bun run dev rows add <sheet-id> -d '[{"cells":[{"columnId":123,"value":"hello"}]}]'
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Minimal dependencies: commander, chalk only
- Type annotations required everywhere
- Use interfaces for all API types

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with Bearer token auth
│   └── index.ts      # Smartsheet API wrapper
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   └── config.ts     # Multi-profile configuration
└── index.ts          # Library exports
```

## API Authentication

Smartsheet uses Bearer token authentication (API access tokens).

Environment variables:
- `SMARTSHEET_ACCESS_TOKEN` - API access token

## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.hasna/connectors/connect-smartsheet/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### API Base URL

All requests go to `https://api.smartsheet.com/2.0`:
- `/sheets` - Sheet operations
- `/sheets/{id}/rows` - Row operations
- `/sheets/{id}/columns` - Column operations
- `/workspaces` - Workspace operations
- `/home/folders` - Personal folders
- `/reports` - Report operations
- `/webhooks` - Webhook operations

## CLI Commands

- `auth set/status/clear` - Authentication
- `profile list/use/create/delete/show` - Profile management
- `sheets list/get/create/update/delete` - Sheet operations
- `rows get/add/update/delete` - Row operations
- `columns list/add/delete` - Column operations
- `folders list/create` - Folder operations
- `workspaces list/create/delete` - Workspace operations
- `reports list/get` - Report operations
- `webhooks list/create` - Webhook operations

## Data Storage

```
~/.hasna/connectors/connect-smartsheet/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "accessToken": "..."
}
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
