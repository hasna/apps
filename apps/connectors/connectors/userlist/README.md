# Userlist Push API Connector

TypeScript connector for the [Userlist Push API](https://userlist.com/docs/developers/push-api/) — a write-only JSON API for users, companies, relationships, events, and transactional messages.

## Features

- Push API authentication (`Authorization: Push <api_key>`)
- Multi-profile configuration
- CLI and programmatic library API
- Handles 202 Accepted empty responses

## Quick Start

```bash
cd connectors/userlist
bun install
export USERLIST_PUSH_API_KEY=your-push-api-key
bun run dev users identify --identifier user-123 --email user@example.com
```

## CLI Commands

```bash
connect-userlist users identify|delete
connect-userlist companies identify|delete
connect-userlist relationships upsert|delete
connect-userlist events track
connect-userlist messages send
connect-userlist profile list|use|create|delete|show
connect-userlist config set-key|show|clear
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `USERLIST_PUSH_API_KEY` | Push API key (required) |
| `USERLIST_PUSH_BASE_URL` | Optional base URL override (default: `https://push.userlist.com`) |

## Library Usage

```typescript
import { Userlist } from '@hasna/connect-userlist';

const userlist = Userlist.fromEnv();

await userlist.users.identify({
  identifier: 'user-123',
  email: 'user@example.com',
  properties: { first_name: 'Jane' },
});

await userlist.events.track({
  name: 'project_created',
  user: 'user-123',
  properties: { project_name: 'New Project' },
});
```

## Build

```bash
bun run typecheck
bun run build
bun test src/api/client.test.ts
```

## License

Apache-2.0
