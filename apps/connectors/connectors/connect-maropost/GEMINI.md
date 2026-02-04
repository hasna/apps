# GEMINI.md

This file provides guidance to Gemini when working with this repository.

## Project Overview

connect-connect-maropost is a TypeScript connector for the Maropost Marketing Cloud API. It provides both a CLI tool and a TypeScript library for interacting with Maropost services including contacts, lists, campaigns, reports, journeys, and transactional emails.

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

Bearer Token authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-maropost config set-key <key>`


## API Modules

### Contacts API
- CRUD operations for contacts
- Email lookup
- Tag management
- List subscription management
- Do-Not-Mail list management

### Lists API
- CRUD operations for lists
- Get contacts in a list
- Add/remove contacts from lists

### Campaigns API
- List and get campaigns
- Campaign reports: opens, clicks, bounces, unsubscribes, complaints, deliveries

### Reports API
- Account-wide analytics
- Date range filtering (from/to parameters)

### Journeys API
- List and get journeys
- Pause/resume/reset journeys for specific contacts
- Add contacts to journeys

### Transactional API
- Send transactional emails via JetSend
- Simple send with to/subject/html/text
- Batch send with substitution data

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MAROPOST_API_KEY` | API key (overrides profile) |
| `MAROPOST_ACCOUNT_ID` | Account ID (overrides profile) |
| `MAROPOST_BASE_URL` | Override base URL |

## Data Storage

```
~/.connect/connect-maropost/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
