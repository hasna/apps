# GEMINI.md

This file provides guidance to Gemini when working with this repository.

## Project Overview

connect-x is a TypeScript connector for the X (Twitter) API v2. It provides both a CLI and library interface for:

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

OAuth authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-x config set-key <key>`
- OAuth flow: `connect-x oauth login`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `X_API_KEY` | API key (Consumer Key) |
| `X_API_SECRET` | API secret (Consumer Secret) |
| `X_BEARER_TOKEN` | Optional pre-generated Bearer token |
| `X_CLIENT_ID` | OAuth 2.0 Client ID |
| `X_CLIENT_SECRET` | OAuth 2.0 Client Secret (optional) |
| `X_ACCESS_TOKEN` | OAuth 2.0 user access token |
| `X_REFRESH_TOKEN` | OAuth 2.0 refresh token |
| `X_OAUTH1_ACCESS_TOKEN` | OAuth 1.0a access token |
| `X_OAUTH1_ACCESS_TOKEN_SECRET` | OAuth 1.0a access token secret |

## Data Storage

```
~/.connect/connect-x/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
