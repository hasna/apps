# @hasna/connect-zapier-api-platform

TypeScript connector for the [Zapier API Platform](https://api.zapierapiplatform.com/v1).

## Features

- Bearer API key authentication
- Items list, get, and create
- Events listing
- Search endpoint
- Raw HTTP request support
- Multi-profile CLI configuration

## Quick Start

```bash
bun install
export ZAPIER_API_PLATFORM_API_KEY=your-api-key-here
bun run dev items list
```

## CLI

```bash
connect-zapier-api-platform items list
connect-zapier-api-platform items get <itemId>
connect-zapier-api-platform items create -d '{"name":"example"}'
connect-zapier-api-platform events list
connect-zapier-api-platform search run -d '{"query":"example"}'
connect-zapier-api-platform raw request --path /items
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-zapier-api-platform';

const client = new Connector({ apiKey: process.env.ZAPIER_API_PLATFORM_API_KEY! });
const items = await client.items.list();
const item = await client.items.get('item-1');
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZAPIER_API_PLATFORM_API_KEY` | API key |
| `ZAPIER_API_PLATFORM_BASE_URL` | Optional base URL override |

## License

Apache-2.0
