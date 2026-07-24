# Snov.io Connector

TypeScript API connector for [Snov.io](https://snov.io) — email outreach, prospecting, domain search, and campaign management.

## Authentication

Snov.io uses OAuth2 client credentials. Get your **API User ID** and **API Secret** from Account → API in your Snov.io dashboard.

```bash
connect-snov-io config set-client-id <your-api-user-id>
connect-snov-io config set-client-secret <your-api-secret>
```

Or set environment variables:

```bash
export SNOV_IO_CLIENT_ID=your-api-user-id
export SNOV_IO_CLIENT_SECRET=your-api-secret
```

## CLI Commands

```bash
# Configuration
connect-snov-io config show
connect-snov-io profile list

# Campaigns
connect-snov-io campaigns list

# Domain search (async task flow)
connect-snov-io domain-search start --domain snov.io
connect-snov-io domain-search result --task <task_hash>

# Account
connect-snov-io account info

# Raw API escape hatch
connect-snov-io raw GET /v1/get-user-campaigns --v1
```

## Library Usage

```typescript
import { SnovIo } from '@hasna/connect-snov-io';

const client = new SnovIo({
  clientId: process.env.SNOV_IO_CLIENT_ID!,
  clientSecret: process.env.SNOV_IO_CLIENT_SECRET!,
});

const campaigns = await client.campaigns.list();
const balance = await client.account.getBalance();
```

## API Reference

- Base URL: `https://api.snov.io`
- Auth: POST `/v1/oauth/access_token` (client_credentials)
- Rate limit: 60 requests/minute
- Docs: https://snov.io/api

## Development

```bash
bun install
bun run dev config show
bun run typecheck
bun run build
```

## License

Apache-2.0
