# Travo Data Connector

TypeScript CLI and library for the [Travo Data](https://api.travo-real-estate.com/v1) real estate API.

## Install

```bash
bun install
```

## Authentication

Bearer token via API key:

- Environment: `TRAVO_REAL_ESTATE_API_KEY`
- Profile: `connect-travo-real-estate config set-key <key>`
- Optional base URL override: `TRAVO_REAL_ESTATE_BASE_URL`

## CLI

```bash
bun run dev profile list
bun run dev config set-key your-api-key
bun run dev listings list
bun run dev listings get <listingId>
bun run dev listings create --body '{"title":"Example"}'
bun run dev events list
bun run dev search --body '{"query":"apartment"}'
bun run dev raw GET /listings
```

## Library

```typescript
import { TravoRealEstate } from '@hasna/connect-travo-real-estate';

const client = TravoRealEstate.fromEnv();
const listings = await client.listListings();
```

## Development

```bash
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
