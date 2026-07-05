# connect-tyk-api-platform

TypeScript connector for the [Tyk API Platform](https://tyk.io/) REST API.

## Features

- Bearer token (`api_key`) authentication
- Multi-profile configuration
- Items, events, and search endpoints
- Raw API request escape hatch
- CLI and programmatic library API

## Quick Start

```bash
cd connectors/tyk-api-platform
bun install

# Configure credentials
bun run dev config set-key your-api-key

# List items
bun run dev item list

# Search
bun run dev search --data '{"query":"gateway"}'
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TYK_API_PLATFORM_API_KEY` | API key |
| `TYK_API_PLATFORM_BASE_URL` | Optional base URL (default: `https://api.tykapiplatform.com/v1`) |

## Library Usage

```typescript
import { TykApiPlatform } from '@hasna/connect-tyk-api-platform';

const client = new TykApiPlatform({
  apiKey: process.env.TYK_API_PLATFORM_API_KEY!,
});

const items = await client.listItems();
const item = await client.getItem('item-123');
const results = await client.search({ query: 'gateway' });
```

## License

Apache-2.0
