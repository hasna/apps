# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Google Workspace API connector CLI - Gmail, Drive, Calendar, Docs, Sheets

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

## Auth Notes (2026)

Google OAuth 2.0 — use Application Default Credentials or service account JSON.

### Maps Platform Client IDs Deprecated (May 2025+)
Maps platform client IDs deprecated May 26, 2025, cannot be used after May 31, 2026.
- In Apps Script: `setAuthentication(clientId, signingKey)` → deprecated Jun 2026
- Use `setAuthenticationByKey(apiKey)` or `setAuthenticationByKey(apiKey, signingKey)` instead

OAuth scopes are unchanged. userinfo endpoint: `https://www.googleapis.com/oauth2/v3/userinfo`

## Authentication

API Key authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-google config set-key <key>`


## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_API_KEY` | API key |

## Data Storage

```
~/.hasna/connectors/connect-google/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
