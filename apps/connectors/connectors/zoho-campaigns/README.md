# Zoho Campaigns Connector

TypeScript connector for the [Zoho Campaigns API v1.1](https://www.zoho.com/campaigns/help/developers/). Manage mailing lists, subscribers, email campaigns, and reports.

## Installation

```bash
bun install
bun run build
```

## Authentication

Zoho Campaigns uses OAuth 2.0 access tokens with the `Zoho-oauthtoken` authorization header. Set your token and data center:

```bash
export ZOHOCAMPAIGNS_TOKEN=your-oauth-access-token
export ZOHOCAMPAIGNS_DATA_CENTER=com
```

Or use the CLI profile:

```bash
bun run dev config set-token <token>
bun run dev config set-dc eu
```

### Data centers

| Value | API host |
|-------|----------|
| `com` | campaigns.zoho.com |
| `eu` | campaigns.zoho.eu |
| `in` | campaigns.zoho.in |
| `com.au` | campaigns.zoho.com.au |
| `jp` | campaigns.zoho.jp |
| `ca` | campaigns.zoho.ca |
| `sa` | campaigns.zoho.sa |

## CLI Usage

```bash
bun run dev list ls
bun run dev subscriber ls <listKey>
bun run dev campaign recent
bun run dev report get <campaignKey>
bun run dev topic ls
bun run dev segment ls
bun run dev field ls
```

## Library Usage

```typescript
import { ZohoCampaigns } from '@hasna/connect-zoho-campaigns';

const zc = ZohoCampaigns.fromEnv();
const lists = await zc.listMailingLists();
```

## License

Apache-2.0
