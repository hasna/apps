# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-tyk is a TypeScript connector for the Tyk Dashboard REST API (Tyk Cloud). It provides a CLI and programmatic interface for listing APIs, creating APIs, fetching API definitions, listing events, searching, and making raw API requests.

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
connect-tyk profile list
connect-tyk profile use <name>
connect-tyk profile create <name>
connect-tyk profile delete <name>
connect-tyk profile show [name]

# Configuration
connect-tyk config set-key <key>
connect-tyk config set-base-url <url>
connect-tyk config show
connect-tyk config clear

# APIs
connect-tyk api list
connect-tyk api get <apiId>
connect-tyk api create --data '{"name":"example"}'

# Events
connect-tyk event list

# Search
connect-tyk search --data '{"query":"gateway"}'

# Raw API access
connect-tyk raw --path /apis --method GET
connect-tyk raw --path /search --method POST --data '{"query":"test"}'
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TYK_API_KEY` | API key (overrides profile config) |
| `TYK_BASE_URL` | API base URL (default: `https://api.tyk.io/v1`) |

## Authentication

Uses Bearer token (`api_key`) authentication. Set your API key via the CLI or environment variable.

## Data Storage

```
~/.hasna/connectors/connect-tyk/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "apiKey": "your-api-key",
  "baseUrl": "https://api.tyk.io/v1"
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
│   └── index.ts        # Tyk API wrapper
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

- APIs: list, get, create
- Events: list
- Search: POST /search
- Raw request: arbitrary path/method/query/body
