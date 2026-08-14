# CLAUDE.md

Guidance for working with the Weezevent connector.

## Project Overview

`@hasna/connect-weezevent` is a TypeScript connector for the [Weezevent Ticketing API](https://api.weezevent.com/). It provides event listing, ticketing, participant management, and optional token exchange via CLI and library exports.

## Authentication

Weezevent uses dual query-parameter authentication on every API request:

- `api_key` — partner API key from back-office Tools > API Key
- `access_token` — persistent token from `POST /auth/access_token` (username + password + api_key)

Both credentials are required before making API calls.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WEEZEVENT_API_KEY` | Partner API key (overrides profile) |
| `WEEZEVENT_ACCESS_TOKEN` | Access token (overrides profile) |
| `WEEZEVENT_BASE_URL` | Optional API base URL override |

## CLI Commands

```bash
bun run dev events list [--include-closed]
bun run dev events details <eventId>
bun run dev events search --date-start 2024-01-01 --date-end 2024-12-31
bun run dev dates list -e 11435,10473
bun run dev tickets list -e 11435
bun run dev tickets stats <ticketId> [--date-id 138]
bun run dev participants list -e 11122 --full
bun run dev participants answers <participantId>
bun run dev auth token -u <username> -w <password>
bun run dev config set-key <key>
bun run dev config set-access-token <token>
bun run dev profile list|use|create|delete|show
```

Global flags: `-k/--api-key`, `--access-token`, `-p/--profile`, `-f/--format`, `-v/--verbose`.

## Data Storage

Profiles are stored at `~/.hasna/connectors/weezevent/profiles/`:

```json
{
  "apiKey": "...",
  "accessToken": "..."
}
```

## Build & Test

```bash
bun install
bun run typecheck
bun test src/api/client.test.ts
bun run build
```
