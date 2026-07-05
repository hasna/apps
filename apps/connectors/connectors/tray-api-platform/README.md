# connect-tray-api-platform

TypeScript connector for the **Tray API Platform customer runtime API** (`api.trayapiplatform.com`).

This package targets the deployed runtime API exposed to your integration consumers (`/items`, `/events`, `/search`). It is **not** the tray.io iPaaS or Tray Platform workspace management API.

## Install

```bash
bun install
bun run build
```

## Authentication

Bearer token (`Authorization: Bearer <api_key>`).

| Variable | Description |
|----------|-------------|
| `TRAY_API_PLATFORM_API_KEY` | Runtime API key |
| `TRAY_API_PLATFORM_BASE_URL` | Optional tenant-specific base URL |

Profiles are stored under `~/.hasna/connectors/connect-tray-api-platform/`.

## CLI

```bash
connect-tray-api-platform items list
connect-tray-api-platform items get <itemId>
connect-tray-api-platform items create --body '{"name":"example"}'
connect-tray-api-platform events list
connect-tray-api-platform search run --body '{"query":"example"}'
connect-tray-api-platform request send -p /items
connect-tray-api-platform config set-key <key>
connect-tray-api-platform config set-base-url <url>
connect-tray-api-platform profile list|use|create|delete|show
```

## Library

```typescript
import { Connector } from '@hasna/connect-tray-api-platform';

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
