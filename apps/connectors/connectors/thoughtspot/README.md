# @hasna/connect-thoughtspot

TypeScript connector for the [ThoughtSpot REST API v2](https://developers.thoughtspot.com/docs/rest-api-v2).

## Features

- Bearer token authentication
- Liveboard list, get, create (TML import), and data retrieval
- Metadata and analytics search
- Security audit log fetch (`/logs/fetch`)
- Raw request escape hatch
- Multi-profile CLI configuration

## Install

```bash
bun install
```

## Configuration

Copy `.env.example` and set:

```bash
THOUGHTSPOT_API_KEY=your-bearer-token
THOUGHTSPOT_BASE_URL=https://your-instance.thoughtspot.cloud/api/rest/2.0
```

Obtain a bearer token via `POST /api/rest/2.0/auth/token/full` on your ThoughtSpot instance. See [authentication docs](https://developers.thoughtspot.com/docs/api-authv2).

Or use the CLI:

```bash
bun run dev config set-key <token>
bun run dev config set-base-url https://your-instance.thoughtspot.cloud/api/rest/2.0
```

## CLI Usage

```bash
bun run dev liveboards list
bun run dev liveboards get "My Liveboard"
bun run dev liveboards create --file import.json
bun run dev events list --body '{"record_size":50}'
bun run dev search data --body '{"query_string":"revenue by region"}'
bun run dev raw -m POST -P /metadata/search --body '{"metadata":[{"type":"LIVEBOARD"}]}'
```

## Library Usage

```typescript
import { ThoughtSpot } from '@hasna/connect-thoughtspot';

const ts = new ThoughtSpot({
  apiKey: process.env.THOUGHTSPOT_API_KEY!,
  baseUrl: process.env.THOUGHTSPOT_BASE_URL!,
});

const liveboards = await ts.liveboards.list();
const results = await ts.search.data({ query_string: 'revenue by region' });
```

## License

Apache-2.0
