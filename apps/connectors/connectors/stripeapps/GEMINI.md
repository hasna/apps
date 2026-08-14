# GEMINI.md

This file provides guidance to Gemini when working with this repository.

## Project Overview

Stripe Apps connector CLI - items, events, search, and raw requests against the Stripe Apps REST API.

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

# Run tests
bun test
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
│   ├── client.ts  # HTTP client with Bearer authentication
│   ├── items.ts   # Items endpoints
│   ├── events.ts  # Events endpoint
│   ├── search.ts  # Search endpoint
│   └── index.ts   # Main connector class (+ raw requests)
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

API Key authentication via a Bearer token. Credentials can be set via:
- Environment variables (see below)
- Profile configuration: `connect-stripeapps config set-key <key>`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STRIPEAPPS_API_KEY` | API key (used as a Bearer token) |
| `STRIPEAPPS_BASE_URL` | Optional API base URL override |

## Data Storage

```
~/.hasna/connectors/stripeapps/
├── current_profile      # Active profile name
└── profiles/
    └── {name}/
        └── config.json  # Per-profile credentials
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
