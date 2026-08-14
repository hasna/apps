# CLAUDE.md

Guidance for the `@hasna/connect-ssh` connector.

## Overview

REST API connector for SSH.com PrivX automation and sessions (`https://api.ssh.com/v1`). Bearer token authentication. This is a REST client only — not an SSH shell protocol client.

## API Details

- **Base URL**: `https://api.ssh.com/v1` (override with `SSH_BASE_URL`)
- **Auth**: Bearer token (`Authorization: Bearer <api_key>`)
- **Endpoints**: `GET /sessions`, `POST /sessions`, `GET /sessions/:id`, `GET /events`, `POST /search`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SSH_API_KEY` | API key (required) |
| `SSH_BASE_URL` | Override base URL (optional) |

## CLI Commands

```bash
ssh config set-key <key>
ssh config set-base-url <url>
ssh list-sessions
ssh create-session [--body <json>]
ssh get-session --session-id <id>
ssh list-events
ssh search --body <json>
ssh raw-request --path <path> [--method GET] [--body <json>]
```

## Build & Run

```bash
bun install
bun run dev -- --help
bun run build
bun run typecheck
bun test src/api/client.test.ts
```

## Data Storage

```
~/.hasna/connectors/ssh/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON:

```json
{
  "apiKey": "your-api-key",
  "baseUrl": "https://api.ssh.com/v1"
}
```
