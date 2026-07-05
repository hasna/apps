# @hasna/connect-trigger-dev-api-platform

TypeScript connector for the [Trigger.dev](https://trigger.dev) management REST API.

## Features

- List and retrieve task runs
- Trigger tasks with payloads and options
- List and inspect schedules
- Execute TRQL analytics queries
- Multi-profile configuration with Bearer auth (secret key or PAT)

## Quick Start

```bash
cd connectors/trigger-dev-api-platform
bun install
bun run dev config set-key tr_dev_your_key_here
bun run dev runs list --period 7d
```

## Authentication

| Method | Env / profile field | Notes |
|--------|---------------------|-------|
| Secret key | `TRIGGER_SECRET_KEY` / `apiKey` | Project-scoped (`tr_dev_*`, `tr_prod_*`) |
| PAT | `TRIGGER_PAT` / `apiKey` | Also set `TRIGGER_PROJECT_REF` / `projectRef` |

## Library Usage

```typescript
import { TriggerDevApiPlatform } from '@hasna/connect-trigger-dev-api-platform';

const api = new TriggerDevApiPlatform({
  apiKey: process.env.TRIGGER_SECRET_KEY!,
});

const runs = await api.listRuns({ period: '7d', pageSize: 10 });
const triggered = await api.triggerTask('my-task', { payload: { hello: 'world' } });
```

## API Docs

- https://trigger.dev/docs/management/overview
- OpenAPI: https://trigger.dev/docs/v3-openapi.yaml

## License

Apache-2.0
