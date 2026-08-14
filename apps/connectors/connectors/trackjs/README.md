# connect-trackjs

TypeScript connector for the [TrackJS Data API](https://docs.trackjs.com/data-api/). Query error events, message aggregates, URL breakdowns, and daily/hourly counts.

## Authentication

TrackJS requires **account owner** credentials:

- `TRACKJS_CUSTOMER_ID` — embedded in the API base URL
- `TRACKJS_API_KEY` — sent as the raw `Authorization` header value (not `Bearer`)

Base URL pattern: `https://api.trackjs.com/{customerId}/v1`

The Data API is **read-only**.

## Install

```bash
bun install
bun run build
```

## CLI

```bash
connect-trackjs config set-key <apiKey>
connect-trackjs config set-customer <customerId>
connect-trackjs errors list [--start-date ...] [--end-date ...] [--query ...]
connect-trackjs errors messages [--sort usercount|desc]
connect-trackjs errors urls
connect-trackjs errors daily
connect-trackjs errors hourly
```

## Library

```typescript
import { Trackjs } from '@hasna/connect-trackjs';

const trackjs = Trackjs.fromEnv();
const recent = await trackjs.errors.list({ size: 50 });
```

## License

Apache-2.0
