# connect-workato-api-platform

TypeScript connector for the **Workato API Platform customer runtime API** (`api.workatoapiplatform.com`).

This package targets the deployed runtime API exposed to your integration consumers (`/items`, `/events`, `/search`). It is **not** the Workato workspace management API (`workato.com/api/*`).

## Install

```bash
bun install
bun run build
```

## Authentication

Bearer token (`Authorization: Bearer <api_key>`).

| Variable | Description |
|----------|-------------|
| `WORKATO_API_PLATFORM_API_KEY` | Runtime API key |
| `WORKATO_API_PLATFORM_BASE_URL` | Optional tenant-specific base URL |

Profiles are stored under `~/.hasna/connectors/connect-workato-api-platform/`.

## CLI

```bash
connect-workato-api-platform items list
connect-workato-api-platform items get <itemId>
connect-workato-api-platform items create --body '{"name":"example"}'
connect-workato-api-platform events list
connect-workato-api-platform search run --body '{"query":"example"}'
connect-workato-api-platform request send -p /items
connect-workato-api-platform config set-key <key>
connect-workato-api-platform config set-base-url <url>
connect-workato-api-platform profile list|use|create|delete|show
```

## Library

```typescript
import { Connector } from '@hasna/connect-workato-api-platform';

const api = Connector.fromEnv();
const items = await api.items.list();
const item = await api.items.get('abc123');
await api.items.create({ name: 'example' });
const events = await api.events.list();
const results = await api.search.search({ query: 'example' });
```

## Development

```bash
bun run dev -- items list
bun run typecheck
bun test src/api/client.test.ts
```

## License

Apache-2.0
