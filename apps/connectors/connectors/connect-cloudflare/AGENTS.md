# AGENTS.md

This file provides guidance to AI coding agents when working with this repository.

## Project Overview

Cloudflare API connector CLI - A TypeScript wrapper for the Cloudflare API with multi-profile support

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
- Profile configuration: `connect-cloudflare config set-key <key>`


## Key Patterns

1. **API Client**: All API calls go through `{{SERVICE_NAME_PASCAL}}Client` which handles auth and request formatting
2. **Resource APIs**: Each resource type gets its own API class (e.g., `UsersApi`, `OrdersApi`)
3. **CLI Commands**: Commander-based with subcommands for each resource
4. **Configuration**: Stored in `~/.connect-{{CONNECTOR_NAME}}/config.json`
5. **Environment Variables**: `{{SERVICE_NAME_UPPER}}_API_KEY` for API authentication

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CLOUDFLARE_API_KEY` | API key |

## Data Storage

```
~/.connect/connect-cloudflare/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
