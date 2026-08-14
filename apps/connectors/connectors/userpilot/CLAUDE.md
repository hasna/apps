# CLAUDE.md

Guidance for working with the Userpilot connector.

## Project Overview

connect-userpilot is a TypeScript connector for the Userpilot Analytics API. It provides CLI and library access to user/company management, event tracking, in-app experiences, flows, checklists, surveys, segments, goals, and webhooks.

## Build & Run

```bash
bun install
bun run dev          # Run CLI from source
bun run build
bun run typecheck
bun test
```

## API Authentication

- Base URL: `https://analytex.userpilot.io/v1`
- Auth: `Authorization: Bearer {api_key}`
- Required header: `X-API-Version: 2020-09-22`
- Credential: single `api_key` from Userpilot dashboard (Settings → API)

## Project Structure

```
src/
├── api/
│   ├── client.ts           # HTTP client
│   ├── index.ts            # Main Userpilot class
│   └── *.ts                # Domain modules (users, companies, ...)
├── cli/index.ts            # Commander CLI
├── types/index.ts
└── utils/
    ├── config.ts           # Multi-profile config
    └── output.ts
```

## Configuration

Profiles stored in `~/.hasna/connectors/connect-userpilot/profiles/`:

```json
{ "apiKey": "your-api-key" }
```

Environment variable `USERPILOT_API_KEY` overrides profile config.

## CLI Commands

- `auth set-key/status/clear` — API key management
- `profile list/use/create/delete/show` — Profile management
- `users identify/track/group/list/get/delete` — User operations
- `companies list/get/delete` — Company operations
- `experiences list/get/analytics` — Experience operations
- `flows`, `flow`, `checklists`, `checklist`, `resource-centers`
- `surveys list/get/responses`
- `segments list/get/create/delete`
- `goals list/get/create/delete`
- `events`, `event`, `feature-tags`, `attributes`
- `webhooks list/create/delete`

## Dependencies

- commander — CLI framework
- chalk — Terminal styling
