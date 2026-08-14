# CLAUDE.md

WorkOS connector for enterprise SSO, directory sync, and events.

## Authentication

**Bearer token** via WorkOS API key:

```typescript
Authorization: `Bearer ${apiKey}`
```

Set via `WORKOS_API_KEY` environment variable or `connect-workos config set-key <key>`.

## API Base URL

`https://api.workos.com`

## Build & Run

```bash
bun install
bun run dev organizations list
bun run typecheck
bun test
bun run build
```

## Key Endpoints

| Method | Path | CLI |
|--------|------|-----|
| GET | `/organizations` | `organizations list` |
| GET | `/connections` | `connections list` |
| GET | `/directories` | `directories list` |
| GET | `/directory_users` | `directory-users list --directory-id` |
| GET | `/events` | `events list` |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WORKOS_API_KEY` | API key from WorkOS dashboard |

## Config Storage

`~/.hasna/connectors/workos/profiles/`
