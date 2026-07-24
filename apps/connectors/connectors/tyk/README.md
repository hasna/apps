# connect-tyk

TypeScript connector for the [Tyk Dashboard API](https://tyk.io/) (Tyk Cloud REST API).

## Features

- Bearer token (`api_key`) authentication
- Multi-profile configuration
- API definitions, events, and search endpoints
- Raw API request escape hatch
- CLI and programmatic library API

## Quick Start

```bash
cd connectors/tyk
bun install

# Configure credentials
bun run dev config set-key your-api-key

# List API definitions
bun run dev api list

# Search
bun run dev search --data '{"query":"gateway"}'
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TYK_API_KEY` | API key |
| `TYK_BASE_URL` | Optional base URL (default: `https://api.tyk.io/v1`) |

## Library Usage

```typescript
import { Tyk } from '@hasna/connect-tyk';

const client = new Tyk({
  apiKey: process.env.TYK_API_KEY!,
});

const apis = await client.listApis();
const api = await client.getApi('api-123');
const results = await client.search({ query: 'gateway' });
```

## License

Apache-2.0
