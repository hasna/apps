# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-thousandeyes is a TypeScript connector for the ThousandEyes REST API. It provides a CLI and programmatic interface for managing network tests, events, and search.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun test src/api/client.test.ts
```

## CLI Commands

```bash
# Authentication
connect-thousandeyes config set-api-key <key>    # Set API token
connect-thousandeyes config set-base-url <url>   # Set API base URL
connect-thousandeyes config show                 # Show current config
connect-thousandeyes config clear                # Clear config

# Profile management
connect-thousandeyes profile list                # List profiles
connect-thousandeyes profile use <name>          # Switch profile
connect-thousandeyes profile create <name>       # Create profile
connect-thousandeyes profile delete <name>       # Delete profile

# Validation
connect-thousandeyes validate                    # Validate credentials

# Tests
connect-thousandeyes tests list                  # List tests
connect-thousandeyes tests get <testId>          # Get a test
connect-thousandeyes tests create --body <json>  # Create a test

# Events
connect-thousandeyes events list [--start] [--end] [--test-id] [--type]

# Search & raw API
connect-thousandeyes search --body <json>
connect-thousandeyes request --path <path> [--method] [--query] [--body]
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `THOUSANDEYES_API_KEY` | API token (overrides profile) |
| `THOUSANDEYES_BASE_URL` | API base URL (default `https://api.thousandeyes.com/v1`) |

## Authentication

Uses **Bearer token** authentication. Set your API token via config or `THOUSANDEYES_API_KEY`.

Generate tokens at: https://app.thousandeyes.com/settings/users/

The HTTP client sends `Authorization: Bearer <token>` on every request.

## Data Storage

```
~/.hasna/connectors/connect-thousandeyes/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "apiKey": "xxx",
  "baseUrl": "https://api.thousandeyes.com/v1"
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
│   ├── client.ts     # HTTP client with Bearer token auth
│   ├── client.test.ts
│   └── index.ts      # ThousandEyes API wrapper
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

- Tests: list, get, create
- Events: list
- Search: POST /search
- Raw request escape hatch
- Validate: GET /users
