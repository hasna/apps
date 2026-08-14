# @hasna/connect-usps

USPS shipping API connector for the Hasna connectors monorepo.

## Features

- List, get, and create shipments
- List tracking events
- Search API
- Raw request helper for advanced use
- Multi-profile CLI configuration
- Bearer token authentication

## Setup

```bash
cd connectors/usps
bun install
cp .env.example .env   # add your USPS_API_KEY
```

Register for API credentials at https://developers.usps.com/

## Usage

### CLI

```bash
bun run dev shipments list
bun run dev shipments get SHIPMENT_ID
bun run dev events list
bun run dev search --body '{"query":"tracking-number"}'
```

### Library

```typescript
import { Usps } from '@hasna/connect-usps';

const usps = new Usps({ apiKey: process.env.USPS_API_KEY! });
const shipments = await usps.listShipments();
const shipment = await usps.getShipment('item-1');
```

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/shipments` | List shipments |
| GET | `/shipments/:id` | Get shipment |
| POST | `/shipments` | Create shipment |
| GET | `/events` | List tracking events |
| POST | `/search` | Search |

Default base URL: `https://api.usps.com/v1` (override with `USPS_BASE_URL`).

## License

Apache-2.0
