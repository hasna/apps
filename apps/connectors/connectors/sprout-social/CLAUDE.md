# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-sprout-social is a TypeScript connector for the [Sprout Social API](https://api.sproutsocial.com/docs/). It provides CLI and library access to account metadata, profile and post analytics, inbox messages, draft publishing, cases, and media registration.

The API is **customer-scoped**: every endpoint except `/metadata/client` is nested under a numeric customer id (`/v1/{customer_id}/...`). Discover the customer id with `metadata client`, then set it via `SPROUTSOCIAL_CUSTOMER_ID` or `config set-customer <id>`.

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

# Example commands
bun run dev metadata client
bun run dev metadata profiles
bun run dev analytics profiles --metric impressions --filter 'customer_profile_id.eq(123456)'
bun run dev config show
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Minimal dependencies: commander, chalk only
- Type annotations required everywhere

## Project Structure

```
src/
├── api/
│   ├── client.ts        # HTTP client with Bearer token auth
│   ├── index.ts         # SproutSocial API wrapper class
│   └── client.test.ts   # Transport / auth / error-mapping tests
├── cli/
│   └── index.ts         # CLI commands
├── types/
│   └── index.ts         # Type definitions
├── utils/
│   ├── config.ts        # Multi-profile configuration (token + customer id)
│   └── output.ts        # CLI output formatting
└── index.ts             # Library exports
```

## API Coverage

### Metadata
- Client (customer ids reachable by the token — no customer id required)
- Customer profiles, tags, groups, users, listening topics, teams, case queues

### Analytics
- Profile-level analytics (`POST /analytics/profiles`)
- Post-level analytics (`POST /analytics/posts`)

### Messages / Inbox
- List messages (`POST /messages`, cursor-based paging, requires a group filter)

### Publishing
- Create draft posts (`POST /publishing/posts`, `is_draft` is forced on)
- Get a publishing post by id

### Cases
- Filter cases (`POST /cases/filter`, cursor-based paging)

### Media
- Register media by remote URL (`POST /media/`)

## Authentication

Uses Bearer token authentication:

```typescript
'Authorization': `Bearer ${accessToken}`
```

Requires an API access token (Settings > API in Sprout Social) and, for
customer-scoped endpoints, a numeric customer id.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SPROUTSOCIAL_ACCESS_TOKEN` | Bearer access token (overrides profile) |
| `SPROUTSOCIAL_CUSTOMER_ID` | Numeric customer id (overrides profile) |
| `SPROUTSOCIAL_BASE_URL` | Override base URL (optional) |

## Data Storage

```
~/.hasna/connectors/connect-sprout-social/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
