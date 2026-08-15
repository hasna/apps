# @hasna/connect-transload

TypeScript connector for the [Transload](https://www.ycombinator.com/companies/transload) API — freight dimension measurement and warehouse computer vision.

## Features

- Bearer token authentication with multi-profile support
- Sites, shipments, cameras, and measurement sync
- Raw API request passthrough
- CLI and TypeScript library

## Quick Start

```bash
bun install
export TRANSLOAD_API_KEY=your-api-key
bun run dev -- sites list
```

## CLI

```bash
connect-transload sites list
connect-transload sites get <siteId>
connect-transload shipments list [--site-id <id>]
connect-transload shipments get <shipmentId>
connect-transload measurement get <shipmentId>
connect-transload cameras list [--site-id <id>]
connect-transload measurements sync [--body '{"site_id":"..."}']
connect-transload raw-request --path /sites --method GET
```

## Library

```typescript
import { Connector } from '@hasna/connect-transload';

const client = new Connector({ apiKey: process.env.TRANSLOAD_API_KEY! });
const sites = await client.sites.list();
const measurement = await client.shipments.getMeasurement('shipment-id');
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TRANSLOAD_API_KEY` | API key |
| `TRANSLOAD_BASE_URL` | Optional base URL (default `https://api.transload.com/v1`) |

## License

Apache-2.0
