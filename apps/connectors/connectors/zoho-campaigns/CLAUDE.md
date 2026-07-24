# CLAUDE.md

Guidance for working with the Zoho Campaigns connector.

## Overview

`@hasna/connect-zoho-campaigns` is a TypeScript connector for Zoho Campaigns API v1.1. It provides CLI and library access to mailing lists, subscribers, campaigns, reports, topics, segments, and custom fields.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

OAuth 2.0 access token via `Zoho-oauthtoken` header:

```typescript
Authorization: `Zoho-oauthtoken ${token}`
```

Base URL: `https://campaigns.zoho.{data_center}/api/v1.1`

All requests append `resfmt=JSON`. POST bodies use `application/x-www-form-urlencoded`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZOHOCAMPAIGNS_TOKEN` | OAuth access token |
| `ZOHOCAMPAIGNS_DATA_CENTER` | Data center (`com`, `eu`, `in`, `com.au`, `jp`, `ca`, `sa`) |
| `ZOHOCAMPAIGNS_BASE_URL` | Optional base URL override |

## Profile Storage

```
~/.hasna/connectors/connect-zoho-campaigns/
├── current_profile
└── profiles/
    └── default.json
```

## API Coverage

- **Lists**: getmailinglists, getmailinglistdetails, addlist, updatelist
- **Subscribers**: getlistsubscribers, json/listsubscribe, bulk add, unsubscribe, remove, contact details, tag
- **Campaigns**: recent/all/search, create, clone, send, test mail, stop, delete
- **Reports**: getcampaignreports, summary, members, click details
- **Topics / Segments / Fields**: topics, getallsegments, allcustomfields

## Error Handling

Zoho returns JSON envelopes with `status: "error"` or error codes (`1003`, `9xx`). The client throws `ZohoCampaignsApiError` on HTTP errors and API-level failures.
