# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-dropbox is a TypeScript connector for the Dropbox API. It provides a CLI and library for managing files, folders, sharing, and user account operations.

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
bun run dev files list
bun run dev share list
bun run dev account info
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
│   └── index.ts      # Dropbox API wrapper
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   └── config.ts     # Multi-profile configuration
└── index.ts          # Library exports
```

## API Authentication

Dropbox uses OAuth 2.0 Bearer token authentication. The connector supports:
- Access tokens from environment variables (DROPBOX_ACCESS_TOKEN or DROPBOX_TOKEN)
- Access tokens stored in profile configuration

Two API endpoints:
- `api.dropboxapi.com/2` - Metadata operations (JSON requests)
- `content.dropboxapi.com/2` - File content operations (upload/download)

## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/connect-dropbox/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### File Operations

Upload requests use `Dropbox-API-Arg` header with JSON parameters and `application/octet-stream` content type.

Download requests return file content in body and metadata in `Dropbox-API-Result` header.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DROPBOX_ACCESS_TOKEN` | OAuth access token (primary) |
| `DROPBOX_TOKEN` | OAuth access token (alternative) |

## CLI Commands

- `auth set <token>` - Set access token
- `auth status` - Check authentication
- `auth clear` - Clear credentials
- `profile list/use/create/delete/show` - Profile management
- `files list/info/search/mkdir/delete/copy/move/upload/download/link` - File operations
- `share create/list/revoke/folders/folder-members` - Sharing operations
- `account info/usage` - Account information

## Data Storage

```
~/.connect/connect-dropbox/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "accessToken": "sl...."
}
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
