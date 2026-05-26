# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-amplitude is a TypeScript connector for the Amplitude Analytics API. It provides a CLI and library for tracking events, searching users, managing cohorts, and accessing analytics data.

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

# Run specific commands
bun run dev auth status
bun run dev events track --type "test" --user "user123"
bun run dev users search "user123"
bun run dev cohorts list
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Minimal dependencies: commander, chalk only
- Type annotations required everywhere
- Use interfaces for all API types

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with Basic Auth
│   └── index.ts      # Amplitude API wrapper
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   └── config.ts     # Multi-profile configuration
└── index.ts          # Library exports
```

## API Authentication

Amplitude uses Basic Auth with API Key and Secret Key:
- `Authorization: Basic base64(apiKey:secretKey)`

Two API endpoints:
- `amplitude.com/api/2` - Most API operations
- `api2.amplitude.com/2` - Batch event uploads

## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.hasna/connectors/connect-amplitude/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### API Categories

- **Events**: Track and upload events (batch)
- **Users**: Search users, get user activity
- **Cohorts**: List cohorts, get membership
- **Charts**: Query chart data
- **Taxonomy**: Event types, event properties, user properties

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AMPLITUDE_API_KEY` | API key |
| `AMPLITUDE_SECRET_KEY` | Secret key |

## CLI Commands

- `auth set-key/set-secret/status/clear` - Authentication
- `profile list/use/create/delete/show` - Profile management
- `events track` - Track events
- `users search/activity` - User operations
- `cohorts list/get/members` - Cohort operations
- `charts get` - Chart data
- `taxonomy events/event-properties/user-properties` - Taxonomy

## Data Storage

```
~/.hasna/connectors/connect-amplitude/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "apiKey": "your-api-key",
  "secretKey": "your-secret-key"
}
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
