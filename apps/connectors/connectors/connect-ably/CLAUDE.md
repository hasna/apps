# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

connect-ably is a TypeScript connector for the Ably REST API. It provides a CLI and library for publishing messages, managing channels, querying presence, and retrieving statistics via the Ably platform.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check

# Run specific commands
bun run dev config show
bun run dev messages publish my-channel --name greeting --data '{"text":"hello"}'
bun run dev messages history my-channel
bun run dev channels list
bun run dev channels get my-channel
bun run dev presence get my-channel
bun run dev presence history my-channel
bun run dev stats get
bun run dev stats time
bun run dev profile list
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
│   ├── client.ts     # HTTP client with Basic auth, retry, timeout
│   ├── messages.ts   # Messages API (publish, history)
│   ├── channels.ts   # Channels API (list, get)
│   ├── presence.ts   # Presence API (get, history)
│   ├── stats.ts      # Stats API (get, time)
│   └── index.ts      # Main Connector class
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   ├── auth.ts       # OAuth2 authentication
│   ├── bulk.ts       # Bulk operation utilities
│   ├── config.ts     # Multi-profile configuration
│   ├── output.ts     # CLI output formatting
│   ├── settings.ts   # User preferences storage
│   └── storage.ts    # Local data storage
├── index.ts          # Library exports
scripts/
└── release.ts        # Release automation
```

## API Details

- **Base URL**: `https://rest.ably.io`
- **Auth**: HTTP Basic Auth with API key (`Authorization: Basic base64(apiKey)`)
- **API Key Format**: `appId.keyId:keySecret`
- **Endpoints**:
  - `POST /channels/{channelId}/messages` - Publish a message
  - `GET /channels/{channelId}/messages` - Message history
  - `GET /channels` - List active channels
  - `GET /channels/{channelId}` - Get channel details
  - `GET /channels/{channelId}/presence` - Current presence members
  - `GET /channels/{channelId}/presence/history` - Presence history
  - `GET /stats` - Application statistics
  - `GET /time` - Server time

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ABLY_API_KEY` | API key (overrides profile) |
| `ABLY_TOKEN` | Token (alias for API key) |
| `ABLY_API_SECRET` | API secret (optional) |

## CLI Global Flags

| Flag | Description |
|------|-------------|
| `-k, --api-key <key>` | Override API key for this command |
| `-p, --profile <name>` | Use specific profile |
| `-f, --format <format>` | Output format (json, pretty) |
| `-v, --verbose` | Enable debug output |

## Data Storage

```
~/.connect/connect-ably/
├── current_profile     # Active profile name
├── settings.json       # User preferences
└── profiles/
    ├── default.json    # Default profile
    └── {name}.json     # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
