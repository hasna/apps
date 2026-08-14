# CLAUDE.md

Guidance for working with the Twilio Api Platform connector.

## Overview

`connect-twilio-api-platform` is a TypeScript CLI and library for the Twilio Api Platform REST API (`https://api.twilioapiplatform.com/v1`). This is distinct from `connect-twilio` (classic Twilio SMS/voice at `api.twilio.com`).

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer Token authentication. Credentials can be set via:
- Environment variable `TWILIO_API_PLATFORM_API_KEY`
- Profile configuration: `connect-twilio-api-platform config set-key <key>`

Optional base URL override:
- Environment variable `TWILIO_API_PLATFORM_BASE_URL`
- Profile configuration: `connect-twilio-api-platform config set-base-url <url>`

## API Endpoints

| Operation | Method | Path |
|-----------|--------|------|
| List items | GET | `/items` |
| Create item | POST | `/items` |
| Get item | GET | `/items/{itemId}` |
| List events | GET | `/events` |
| Search | POST | `/search` |
| Raw request | * | arbitrary path under base URL |

## CLI Examples

```bash
connect-twilio-api-platform config set-key YOUR_API_KEY
connect-twilio-api-platform items list
connect-twilio-api-platform items get item-1
connect-twilio-api-platform items create --body '{"name":"example"}'
connect-twilio-api-platform events list
connect-twilio-api-platform search --body '{"query":"term"}'
connect-twilio-api-platform raw --path /items --method GET
```

## Configuration Storage

```
~/.hasna/connectors/connect-twilio-api-platform/
├── current_profile
└── profiles/
    └── default.json
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TWILIO_API_PLATFORM_API_KEY` | Bearer API key |
| `TWILIO_API_PLATFORM_BASE_URL` | Optional API base URL override |
