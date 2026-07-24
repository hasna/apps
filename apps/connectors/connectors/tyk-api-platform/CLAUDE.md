# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-tyk-api-platform is a TypeScript connector for the Tyk API Platform REST API. It provides a CLI and programmatic interface for listing items, creating items, fetching items, listing events, searching, and making raw API requests.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun test              # Run connector tests
```

## CLI Commands

```bash
# Profile management
connect-tyk-api-platform profile list
connect-tyk-api-platform profile use <name>
connect-tyk-api-platform profile create <name>
connect-tyk-api-platform profile delete <name>
connect-tyk-api-platform profile show [name]

# Configuration
connect-tyk-api-platform config set-key <key>
connect-tyk-api-platform config set-base-url <url>
connect-tyk-api-platform config show
connect-tyk-api-platform config clear

# Items
connect-tyk-api-platform item list
connect-tyk-api-platform item get <itemId>
connect-tyk-api-platform item create --data '{"name":"example"}'

# Events
connect-tyk-api-platform event list

# Search
connect-tyk-api-platform search --data '{"query":"gateway"}'

# Raw API access
connect-tyk-api-platform raw --path /items --method GET
connect-tyk-api-platform raw --path /search --method POST --data '{"query":"test"}'
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TYK_API_PLATFORM_API_KEY` | API key (overrides profile config) |
| `TYK_API_PLATFORM_BASE_URL` | API base URL (default: `https://api.tykapiplatform.com/v1`) |

## Authentication

Uses Bearer token (`api_key`) authentication. Set your API key via the CLI or environment variable.

## Data Storage

```
~/.hasna/connectors/connect-tyk-api-platform/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "apiKey": "your-api-key",
  "baseUrl": "https://api.tykapiplatform.com/v1"
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
│   ├── client.ts       # HTTP client with Bearer auth
│   ├── client.test.ts  # Client and API tests
│   └── index.ts        # Tyk API Platform wrapper
├── cli/
│   └── index.ts        # CLI commands
├── types/
│   └── index.ts        # Type definitions
├── utils/
│   ├── config.ts       # Multi-profile configuration
│   └── output.ts       # CLI output formatting
└── index.ts            # Library exports
```

## API Coverage

- Items: list, get, create
- Events: list
- Search: POST /search
- Raw request: arbitrary path/method/query/body
