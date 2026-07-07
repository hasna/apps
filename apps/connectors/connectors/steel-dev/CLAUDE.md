# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-steel-dev is a TypeScript connector for the Steel cloud browser API. It provides both a CLI tool and a TypeScript library for managing browser sessions, session events, and stateless page extraction.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## API Notes (2026)

Steel cloud browser sessions and browser tools API. See https://docs.steel.dev and https://steel.apidocumentation.com/api-reference.

Auth: API key via `steel-api-key` header (`STEEL_API_KEY`).

Key operations:
- `GET /v1/sessions` — list sessions
- `POST /v1/sessions` — create session
- `GET /v1/sessions/:id` — get session
- `GET /v1/sessions/:id/events` — session recording events
- `POST /v1/scrape` — extract page content from a URL

## Authentication

API key authentication via the `steel-api-key` HTTP header. Credentials can be set via:
- Environment variable: `STEEL_API_KEY`
- Profile configuration: `connect-steel-dev config set-key <key>`

Get your API key from https://app.steel.dev/settings/api-keys

## CLI Commands

```bash
connect-steel-dev sessions list
connect-steel-dev sessions create
connect-steel-dev sessions create --use-proxy --solve-captcha
connect-steel-dev sessions get <id>
connect-steel-dev sessions release <id>
connect-steel-dev events list <sessionId>
connect-steel-dev search scrape <url> --format markdown
connect-steel-dev raw request -X GET -p /sessions
connect-steel-dev config set-key <key>
connect-steel-dev profile list
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STEEL_API_KEY` | Steel API key (overrides profile) |
| `STEEL_DEV_BASE_URL` | Override base URL (default `https://api.steel.dev/v1`) |

## Data Storage

```
~/.hasna/connectors/connect-steel-dev/
├── current_profile
└── profiles/
    └── default.json
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
