# connect-tiktok-events-api

TikTok Events API 2.0 connector for server-side conversion events, pixel management, and offline/CRM event sets.

Distinct from `connect-tiktok` (Marketing API). This package targets `POST /event/track/` and related Events API 2.0 endpoints.

## Install

```bash
bun install -g @hasna/connect-tiktok-events-api
```

## Quick start

```bash
connect-tiktok-events-api config set-token YOUR_ACCESS_TOKEN
connect-tiktok-events-api config set-pixel YOUR_PIXEL_CODE
connect-tiktok-events-api track-lead --data '{"user":{"email":"buyer@example.com"}}'
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `TIKTOK_ACCESS_TOKEN` | TikTok Business API access token |
| `TIKTOK_ADVERTISER_ID` | Default advertiser ID |
| `TIKTOK_PIXEL_CODE` | Default web pixel code |
| `TIKTOK_APP_ID` | Default app ID for app events |
| `TIKTOK_OFFLINE_EVENT_SET_ID` | Default offline event set ID |
| `TIKTOK_CRM_EVENT_SET_ID` | Default CRM event set ID |
| `TIKTOK_TEST_EVENT_CODE` | Default test event code |
| `TIKTOK_API_BASE_URL` | API base URL (default: TikTok Business API v1.3) |

## Library usage

```typescript
import { TikTokEventsApi } from '@hasna/connect-tiktok-events-api';

const client = new TikTokEventsApi({
  accessToken: process.env.TIKTOK_ACCESS_TOKEN!,
  pixelCode: 'PIXEL123',
});

await client.trackLead({
  user: { email: 'buyer@example.com' },
  properties: { value: 42, currency: 'USD' },
});
```

## Configuration storage

```
~/.hasna/connectors/connect-tiktok-events-api/
├── current_profile
└── profiles/
    └── default/
        └── config.json
```

## Build

```bash
bun install
bun run typecheck
bun run build
bun test
```
