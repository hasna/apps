# The Trade Desk Connector

TypeScript connector for [The Trade Desk](https://www.thetradedesk.com/) programmatic advertising REST API.

## Features

- Campaign management (list, get, create)
- Event listing
- Search API
- Raw request escape hatch
- Multi-profile configuration
- Bearer token authentication

## Installation

```bash
bun install
bun run build
```

## Authentication

Set your long-lived API token via environment variable or profile config:

```bash
export THE_TRADE_DESK_API_KEY=your-token-here
# or
connect-the-trade-desk config set-key your-token-here
```

## CLI Usage

```bash
connect-the-trade-desk campaigns list
connect-the-trade-desk campaigns get <campaignId>
connect-the-trade-desk campaigns create --json '{"name":"My Campaign"}'
connect-the-trade-desk events list
connect-the-trade-desk search --json '{"query":"advertiser"}'
connect-the-trade-desk raw-request GET /campaigns
connect-the-trade-desk profile list
connect-the-trade-desk config show
```

## Library Usage

```typescript
import { TheTradeDesk } from '@hasna/connect-the-trade-desk';

const ttd = TheTradeDesk.fromEnv();
const campaigns = await ttd.campaigns.list();
```

## API Reference

- **Base URL**: `https://api.thetradedesk.com/v1` (override with `THE_TRADE_DESK_BASE_URL`)
- **Auth**: `Authorization: Bearer <api_key>`

## License

Apache-2.0
