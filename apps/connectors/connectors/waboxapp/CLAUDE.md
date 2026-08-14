# CLAUDE.md

Guidance for Claude Code when working with the WaboxApp connector.

## Project Overview

WaboxApp WhatsApp messaging API connector — send chat, image, link, and media messages and check account status via the public REST API.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## API Notes

- Base URL: `https://www.waboxapp.com/api`
- Requests: `GET` / `POST` with `application/x-www-form-urlencoded`
- Responses: JSON with `success` field
- Docs: https://www.waboxapp.com/assets/doc/waboxapp-API-v3.pdf

Endpoints:
- `POST /send/chat` — text messages
- `POST /send/image` — image messages
- `POST /send/link` — link previews
- `POST /send/media` — file attachments
- `GET /status/{uid}?token=...` — account status

## Authentication

API Key (`token` query/body parameter) plus sender `uid` (WhatsApp number with country code). Not Bearer auth.

Configure via:
- `connect-waboxapp config set-token <token>`
- `connect-waboxapp config set-uid <uid>`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WABOXAPP_TOKEN` | WaboxApp API token (overrides profile) |
| `WABOXAPP_UID` | Sender WhatsApp number with international code |
| `WABOXAPP_BASE_URL` | Optional API base URL override |

## Data Storage

```
~/.hasna/connectors/connect-waboxapp/
├── current_profile
└── profiles/
    ├── default.json
    └── {name}.json
```

Profile JSON:
```json
{
  "token": "your-api-token",
  "uid": "34666123456"
}
```

## Dependencies

- commander
- chalk
