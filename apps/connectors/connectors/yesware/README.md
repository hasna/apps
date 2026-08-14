# @hasna/connect-yesware

TypeScript connector for the [Yesware](https://www.yesware.com/) sales email tracking and outreach API.

## Features

- Bearer token authentication
- Multi-profile CLI configuration
- Sequences: list, get, create
- Events: list email tracking events
- Search: query outreach analytics
- Library and CLI entry points

## Authentication

Yesware uses a Bearer API key. Set `YESWARE_API_KEY` or configure via the CLI:

```bash
bun run dev config set-key <your-api-key>
```

## API Surface

Yesware does not publish a full OpenAPI spec. This connector implements the REST endpoints documented in Yesware's API:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/sequences` | List sequences |
| POST | `/sequences` | Create a sequence |
| GET | `/sequences/:id` | Get sequence by ID |
| GET | `/events` | List tracking events |
| POST | `/search` | Search outreach data |

Base URL: `https://api.yesware.com/v1` (override with `YESWARE_BASE_URL`).

## Quick Start

```bash
bun install
bun run dev sequences list
bun run dev events list
bun run dev search run --query "opens:last-7-days"
```

## Library Usage

```typescript
import { Yesware } from '@hasna/connect-yesware';

const yesware = Yesware.fromEnv();
const sequences = await yesware.listSequences();
const events = await yesware.listEvents({ limit: 50 });
```

## Development

```bash
bun run typecheck
bun run build
bun test src/api/client.test.ts
```

## License

Apache-2.0
