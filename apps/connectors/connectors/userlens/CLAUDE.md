# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-userlens is a TypeScript connector for [Userlens](https://userlens.io/) customer success analytics. It provides CLI and programmatic access to identify users, group accounts, track events, and forward raw events via the public REST API documented at https://userlens.gitbook.io/userlens-analytics/guides/api-reference.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
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
├── api/
│   ├── client.ts   # HTTP client with Basic auth
│   ├── index.ts    # Main connector class
│   └── events.ts   # Identify/group/track/raw helpers
├── cli/
│   └── index.ts    # CLI commands
├── types/
│   └── index.ts    # TypeScript types
├── utils/
│   ├── config.ts   # Multi-profile configuration
│   └── output.ts   # CLI output formatting
└── index.ts        # Library exports
```

## Authentication

API Key authentication (Userlens Write Code). The connector sends HTTP Basic auth with the Write Code as the username and an empty password:

```typescript
Authorization: `Basic ${Buffer.from(`${writeCode}:`).toString('base64')}`
```

Credentials can be set via:
- Environment variable `USERLENS_API_KEY`
- Profile configuration: `connect-userlens config set-key <key>`

## API Endpoints

| Operation | Method | Base URL | Path |
|-----------|--------|----------|------|
| identify / group / track | POST | https://events.userlens.io | /event |
| forward raw events | POST | https://raw.userlens.io | /raw/event |

Optional overrides: `USERLENS_EVENTS_BASE_URL`, `USERLENS_RAW_BASE_URL`.

## CLI Commands

```bash
connect-userlens identify <userId> --traits '{"email":"a@x.com"}'
connect-userlens group <groupId> <userId> --traits '{"name":"Acme"}'
connect-userlens track <userId> <event> --properties '{"feature":"export"}'
connect-userlens forward-raw --events '[{"event":"$ul_pageview","userId":"u1"}]'
connect-userlens raw-request --path /event --method POST --body '{"type":"track","userId":"u1","event":"Ping"}'
connect-userlens config set-key <key>
connect-userlens config show
connect-userlens profile list|use|create|delete|show
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `USERLENS_API_KEY` | Userlens Write Code API key (overrides profile) |
| `USERLENS_EVENTS_BASE_URL` | Events API base URL override |
| `USERLENS_RAW_BASE_URL` | Raw events API base URL override |

## Data Storage

```
~/.hasna/connectors/connect-userlens/
├── current_profile
└── profiles/
    ├── default.json
    └── {name}.json
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
