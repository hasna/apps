# @hasna/connect-v0

TypeScript connector for the [v0 Platform API](https://v0.app/docs/api/platform/overview) — projects, AI chats, deployments, and model completions.

## Features

- Bearer token authentication
- Multi-profile configuration
- Full Platform API coverage (user, projects, chats, messages, deployments, completions)
- Library exports and CLI (`connect-v0`)
- JSON and pretty output formats

## Quick Start

```bash
cd connectors/v0
bun install
export V0_API_KEY=your-api-key-here
bun run dev user get
```

Or configure a profile:

```bash
bun run dev config set-key your-api-key-here
bun run dev projects list
```

## CLI Commands

```bash
connect-v0 profile list|use|create|delete|show
connect-v0 config set-key|show|clear
connect-v0 user get|scopes
connect-v0 projects list|create|get|update|delete
connect-v0 chats list|create|init|get|delete
connect-v0 messages list|get|send
connect-v0 deployments list|create|get
connect-v0 chat-completions
connect-v0 stream-chat-completions
connect-v0 raw-request
```

## Library Usage

```typescript
import { V0 } from '@hasna/connect-v0';

const v0 = V0.fromEnv();
const user = await v0.getUser();
const project = await v0.createProject({ name: 'My App' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `V0_API_KEY` | API key from https://v0.dev/chat/settings/keys |
| `V0_BASE_URL` | Optional base URL (default `https://api.v0.dev/v1`) |

## License

Apache-2.0
