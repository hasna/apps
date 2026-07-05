# CLAUDE.md

Guidance for working with the connect-userlist connector.

## Overview

Userlist Push API connector for lifecycle email marketing — users, companies, relationships, events, and transactional messages.

## API Details

- **Base URL**: `https://push.userlist.com`
- **Auth**: `Authorization: Push <push_api_key>` (NOT Bearer)
- **Format**: Write-only JSON REST; success returns `202 Accepted` with empty body
- **Docs**: https://userlist.com/docs/developers/push-api/

## API Modules

| Module | File | Endpoints |
|--------|------|-----------|
| Users | `src/api/users.ts` | POST/DELETE `/users` |
| Companies | `src/api/companies.ts` | POST/DELETE `/companies` |
| Relationships | `src/api/relationships.ts` | POST/DELETE `/relationships` |
| Events | `src/api/events.ts` | POST `/events` |
| Messages | `src/api/messages.ts` | POST `/messages` |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `USERLIST_PUSH_API_KEY` | Push API key (required) |
| `USERLIST_PUSH_BASE_URL` | Optional base URL override |

## CLI Commands

```bash
connect-userlist users identify|delete
connect-userlist companies identify|delete
connect-userlist relationships upsert|delete
connect-userlist events track
connect-userlist messages send
```

## Key Patterns

- DELETE requests include JSON body (not path-style deletes)
- 202 responses have no body — client returns `{}`
- Custom properties accept nested objects; keys normalized to snake_case by Userlist

## Build & Run

```bash
bun install
bun run dev -- --help
bun run build
bun run typecheck
bun test src/api/client.test.ts
```
