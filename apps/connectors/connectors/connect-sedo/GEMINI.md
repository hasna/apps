# GEMINI.md

This file provides guidance to Gemini when working with this repository.

## Project Overview

Sedo Domain Marketplace API connector CLI - Search, list, and manage domains on Sedo

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

## Authentication

API Key authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-sedo config set-key <key>`


## Key Patterns

1. **API Client**: All API calls go through `SedoClient` which handles XML responses
2. **Domains API**: Domain marketplace operations including search, status, list, add, edit, delete
3. **CLI Commands**: Commander-based with subcommands for domains and config
4. **Configuration**: Stored in `~/.connect-sedo/config.json`
5. **Environment Variables**: `SEDO_PARTNER_ID`, `SEDO_API_KEY`, `SEDO_USERNAME`, `SEDO_PASSWORD`

## CLI Commands

```bash
# Profile Management
connect-sedo profile list
connect-sedo profile use <name>
connect-sedo profile create <name> --set-partner-id <id> --set-api-key <key> --use
connect-sedo profile delete <name>
connect-sedo profile show [name]

# Configuration (applies to active profile)
connect-sedo config set-partner-id <id>
connect-sedo config set-api-key <key>
connect-sedo config set-username <username>
connect-sedo config set-password <password>
connect-sedo config show

# Domain Marketplace
connect-sedo domains search <keyword>
connect-sedo domains search health --tld com --limit 100
connect-sedo domains status domain1.com domain2.com
connect-sedo domains list
connect-sedo domains add example.com --for-sale --price 1000
connect-sedo domains edit example.com --price 2000
connect-sedo domains remove example.com
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SEDO_API_KEY` | API key |

## Data Storage

```
~/.connect/connect-sedo/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
