# connect-tiktokads

TikTok Ads Marketing API connector for the open-connectors monorepo.

This package targets the **Advertising** category (`tiktokads` slug) and covers campaign management, reporting, pixels, and creative assets via the [TikTok Marketing API](https://business-api.tiktok.com/portal/docs).

> **Note:** `connect-tiktok` (`tiktok` slug) is registered under Social Media and exposes a broader Marketing API surface. `connect-tiktokads` is the focused Alumia advertising connector with its own config namespace (`TIKTOK_ADS_*`).

## Install

```bash
bun install
bun run build
```

## Authentication

```bash
connect-tiktokads auth setup <app_id> <app_secret>
connect-tiktokads auth login
connect-tiktokads config set-advertiser <advertiser_id>
```

Or set environment variables (see `.env.example`):

- `TIKTOK_ADS_CLIENT_ID` / `TIKTOK_ADS_CLIENT_SECRET` — OAuth app credentials
- `TIKTOK_ADS_ACCESS_TOKEN` — long-lived access token
- `TIKTOK_ADS_ADVERTISER_ID` — default advertiser account

## CLI examples

```bash
connect-tiktokads advertisers list
connect-tiktokads campaigns list
connect-tiktokads campaigns create --name "Summer" --objective TRAFFIC --budget-mode BUDGET_MODE_DAY --budget 100
connect-tiktokads adgroups list --campaign <campaign_id>
connect-tiktokads ads list --adgroup <adgroup_id>
connect-tiktokads reports integrated --start 2026-01-01 --end 2026-01-31 --metrics spend,impressions,clicks
connect-tiktokads pixels list
connect-tiktokads files videos list
connect-tiktokads files images upload --url https://example.com/banner.jpg
connect-tiktokads raw --path /campaign/get/ --params '{"advertiser_id":"123"}'
```

## Library

```typescript
import { TikTokAds } from '@hasna/connect-tiktokads';

const client = TikTokAds.fromEnv();
const campaigns = await client.campaigns.list({
  advertiser_id: process.env.TIKTOK_ADS_ADVERTISER_ID!,
});
```

## Config storage

```
~/.hasna/connectors/connect-tiktokads/
├── credentials.json
├── current_profile
└── profiles/
    └── default.json
```

## License

Apache-2.0
