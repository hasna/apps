# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-webex is a TypeScript connector for the Cisco Webex REST API with Bearer token authentication and multi-profile configuration support. It provides access to Rooms, Memberships, Messages, People, Teams, Meetings, Recordings, and Webhooks APIs.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer token authentication. Credentials can be set via:
- Environment variable: `WEBEX_ACCESS_TOKEN`
- Profile configuration: `connect-webex config set-token <token>`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WEBEX_ACCESS_TOKEN` | Webex personal access token or bot token (overrides profile) |

## Data Storage

```
~/.hasna/connectors/connect-webex/
├── current_profile
└── profiles/
    ├── default.json
    └── {name}.json
```

## API Base URL

`https://webexapis.com/v1`

## CLI Commands

```bash
connect-webex config set-token <token>
connect-webex config show
connect-webex test
connect-webex rooms list
connect-webex messages send --room-id <id> --text "Hello"
connect-webex meetings list --from <date> --to <date>
connect-webex people me
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
