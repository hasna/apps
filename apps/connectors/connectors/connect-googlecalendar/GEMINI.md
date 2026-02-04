# GEMINI.md

This file provides guidance to Gemini when working with this repository.

## Project Overview

connect-googlecalendar is a TypeScript connector for Google Calendar API. It provides both a CLI and a library for managing calendars and events with OAuth2 authentication and multi-profile support.

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
- Profile configuration: `connect-googlecalendar config set-key <key>`
- OAuth flow: `connect-googlecalendar oauth login`

## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/connect-googlecalendar/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### OAuth2 Authentication

Google Calendar requires OAuth2 authentication:

1. Set up OAuth2 credentials:
   ```bash
   connect-googlecalendar auth setup --client-id <id> --client-secret <secret>
   ```

2. Get authorization URL:
   ```bash
   connect-googlecalendar auth url
   ```

3. Exchange code for tokens:
   ```bash
   connect-googlecalendar auth callback <code>
   ```

Tokens are automatically refreshed when expired if refresh token is available.

### Adding New API Modules

1. Create file in `src/api/` following `calendars.ts` or `events.ts` pattern
2. Add to exports in `src/api/index.ts`
3. Add types in `src/types/index.ts`
4. Add CLI commands in `src/cli/index.ts`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_CALENDAR_ACCESS_TOKEN` | Access token (overrides profile) |
| `GOOGLE_CALENDAR_REFRESH_TOKEN` | Refresh token |
| `GOOGLE_CALENDAR_CLIENT_ID` | OAuth2 Client ID |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | OAuth2 Client Secret |

## Data Storage

```
~/.connect/connect-googlecalendar/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
