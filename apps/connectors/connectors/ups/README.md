# @hasna/connect-ups

TypeScript connector and CLI for the UPS shipping, tracking, and logistics API.

## Setup

```bash
bun install
cp .env.example .env
# Set UPS_API_KEY to your UPS OAuth access token or API bearer token
```

## Usage

### CLI

```bash
bun run dev config set-key <your-token>
bun run dev shipments list
bun run dev shipments get <shipmentId>
bun run dev shipments create --file shipment.json
bun run dev events list
bun run dev search --file search.json
bun run dev raw-request --path /shipments --method GET
```

### Library

```typescript
import { UPS } from '@hasna/connect-ups';

const ups = UPS.fromEnv();
const shipments = await ups.listShipments();
const shipment = await ups.getShipment('shipment-id');
```

## Authentication

UPS Developer API uses OAuth 2.0 client credentials. Obtain an access token from the [UPS Developer Portal](https://developer.ups.com/) and set it as `UPS_API_KEY`.

## License

Apache-2.0
